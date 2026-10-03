import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import {
    startTestDb, stopTestDb, resetDb, seedStock, loginAs, addStock, inDays,
    Stock, StockMovement, Delivery, Lot, Alert, PurchaseOrder
} from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

// Pharmacie + stock + responsable connecté.
async function ctx(quantity = 0) {
    const s = await seedStock(quantity);
    const { agent, user } = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
    return { ...s, agent, user };
}
const pharmacistOf = (c) => loginAs(app, request, "pharmacist", [c.pharmacy._id]);

const deliver = (c, body, key) => {
    const r = c.agent.post("/api/deliveries");
    if (key) r.set("Idempotency-Key", key);
    return r.send({ pharmacy: c.pharmacy._id, medicine: c.medicine._id, ...body });
};
const sell = (c, quantity, key) => {
    const r = c.agent.post(`/api/stocks/${c.stock._id}/movements`);
    if (key) r.set("Idempotency-Key", key);
    return r.send({ type: "OUT", quantity });
};
const qty = async (c) => (await Stock.findById(c.stock._id)).quantity;
const lotOf = (n) => Lot.findOne({ lotNumber: n });

describe("Lots à la réception", () => {
    it("une livraison avec lot crée le lot et trace l'allocation sur le mouvement", async () => {
        const c = await ctx(0);
        const res = await deliver(c, { quantity: 20, lotNumber: "L-A", expiryDate: inDays(200) });
        expect(res.status).toBe(201);
        expect(res.body.lot.remainingQuantity).toBe(20);
        expect(await qty(c)).toBe(20);
        expect(res.body.movement.allocations[0].quantity).toBe(20);
    });

    it("un produit déjà périmé est refusé, sans livraison ni changement de stock", async () => {
        const c = await ctx(0);
        const res = await deliver(c, { quantity: 5, lotNumber: "L-X", expiryDate: inDays(-1) });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("LOT_EXPIRED");
        expect(await qty(c)).toBe(0);
        expect(await Delivery.countDocuments()).toBe(0);
    });

    it("deux livraisons du même lot s'additionnent dans un seul lot", async () => {
        const c = await ctx(0);
        const exp = inDays(200);
        await deliver(c, { quantity: 20, lotNumber: "L-A", expiryDate: exp });
        await deliver(c, { quantity: 10, lotNumber: "L-A", expiryDate: exp });
        expect(await Lot.countDocuments()).toBe(1);
        expect((await lotOf("L-A")).remainingQuantity).toBe(30);
        expect(await qty(c)).toBe(30);
    });

    it("un lot en quarantaine ne peut pas recevoir de nouvelles unités", async () => {
        const c = await ctx(0);
        const exp = inDays(200);
        await deliver(c, { quantity: 10, lotNumber: "L-Q", expiryDate: exp });
        await c.agent.post(`/api/lots/${(await lotOf("L-Q"))._id}/quarantine`).send({ reason: "Suspicion de contamination" });
        const res = await deliver(c, { quantity: 5, lotNumber: "L-Q", expiryDate: exp });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("LOT_NOT_ACTIVE");
    });
});

describe("FEFO et péremption", () => {
    it("vend d'abord le lot qui périme le plus tôt", async () => {
        const c = await ctx(0);
        await deliver(c, { quantity: 10, lotNumber: "TARD", expiryDate: inDays(200) });
        await deliver(c, { quantity: 10, lotNumber: "TOT", expiryDate: inDays(100) });
        const res = await sell(c, 12);
        expect(res.status).toBe(201);
        expect((await lotOf("TOT")).remainingQuantity).toBe(0);
        expect((await lotOf("TARD")).remainingQuantity).toBe(8);
        expect(res.body.movement.allocations).toHaveLength(2);
    });

    it("un lot périmé n'est jamais vendu : retiré du stock disponible, vente refusée", async () => {
        const c = await ctx(10);
        await Lot.create({ stock: c.stock._id, pharmacy: c.pharmacy._id, medicine: c.medicine._id,
            lotNumber: "PERIME", expiryDate: inDays(-1), receivedQuantity: 10, remainingQuantity: 10 });
        const res = await sell(c, 1);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("INSUFFICIENT_STOCK");
        expect((await lotOf("PERIME")).state).toBe("EXPIRED");
        expect(await StockMovement.countDocuments({ type: "EXPIRY", status: "APPLIED" })).toBe(1);
        expect(await qty(c)).toBe(0);
    });

    it("stock mixte : seules les unités valides se vendent, le reste périmé est isolé", async () => {
        const c = await ctx(15);
        const base = { stock: c.stock._id, pharmacy: c.pharmacy._id, medicine: c.medicine._id };
        await Lot.create({ ...base, lotNumber: "VIEUX", expiryDate: inDays(-5), receivedQuantity: 10, remainingQuantity: 10 });
        await Lot.create({ ...base, lotNumber: "BON", expiryDate: inDays(100), receivedQuantity: 5, remainingQuantity: 5 });
        expect((await sell(c, 5)).status).toBe(201);
        expect((await sell(c, 1)).status).toBe(409);
        const summary = (await c.agent.get(`/api/stocks/${c.stock._id}/summary`)).body;
        expect(summary).toMatchObject({ available: 0, expired: 10, physical: 10, consistent: true });
    });

    it("la péremption est constatée une seule fois (idempotente)", async () => {
        const c = await ctx(10);
        await Lot.create({ stock: c.stock._id, pharmacy: c.pharmacy._id, medicine: c.medicine._id,
            lotNumber: "PERIME", expiryDate: inDays(-1), receivedQuantity: 10, remainingQuantity: 10 });
        await Promise.all([sell(c, 1), sell(c, 1), sell(c, 1)]);
        expect(await StockMovement.countDocuments({ type: "EXPIRY", status: "APPLIED" })).toBe(1);
        expect(await qty(c)).toBe(0);
    });
});

describe("Quarantaine", () => {
    it("un lot en quarantaine sort du stock disponible et redevient vendable après libération", async () => {
        const c = await ctx(0);
        await deliver(c, { quantity: 10, lotNumber: "L-Q", expiryDate: inDays(200) });
        const lot = await lotOf("L-Q");

        const q = await c.agent.post(`/api/lots/${lot._id}/quarantine`).send({ reason: "Rappel de lot du fabricant" });
        expect(q.status).toBe(200);
        expect(await qty(c)).toBe(0);
        expect((await sell(c, 1)).status).toBe(409);

        const r = await c.agent.post(`/api/lots/${lot._id}/release`).send({ reason: "Contrôle qualité conforme" });
        expect(r.status).toBe(200);
        expect(await qty(c)).toBe(10);
        expect((await sell(c, 1)).status).toBe(201);
    });

    it("quarantaine deux fois : refusée ; libération d'un lot périmé : refusée", async () => {
        const c = await ctx(0);
        await deliver(c, { quantity: 10, lotNumber: "L-Q", expiryDate: inDays(200) });
        const lot = await lotOf("L-Q");
        const body = { reason: "Motif de test valable" };
        expect((await c.agent.post(`/api/lots/${lot._id}/quarantine`).send(body)).status).toBe(200);
        expect((await c.agent.post(`/api/lots/${lot._id}/quarantine`).send(body)).status).toBe(409);

        const old = await Lot.create({ stock: c.stock._id, pharmacy: c.pharmacy._id, medicine: c.medicine._id,
            lotNumber: "OLD", expiryDate: inDays(-2), receivedQuantity: 3, remainingQuantity: 3, state: "QUARANTINE" });
        const res = await c.agent.post(`/api/lots/${old._id}/release`).send(body);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("LOT_EXPIRED");
    });

    it("un simple pharmacien peut mettre en quarantaine mais pas libérer", async () => {
        const c = await ctx(0);
        await deliver(c, { quantity: 10, lotNumber: "L-Q", expiryDate: inDays(200) });
        const lot = await lotOf("L-Q");
        const p = await pharmacistOf(c);
        expect((await p.agent.post(`/api/lots/${lot._id}/quarantine`).send({ reason: "Emballage abîmé" })).status).toBe(200);
        expect((await p.agent.post(`/api/lots/${lot._id}/release`).send({ reason: "Je le remets en vente" })).status).toBe(403);
    });
});

describe("Corrections, pertes et synthèse", () => {
    it("correction d'inventaire : justification obligatoire, sens explicite, trace signée", async () => {
        const c = await ctx(10);
        const url = `/api/stocks/${c.stock._id}/movements`;
        expect((await c.agent.post(url).send({ type: "ADJUSTMENT", direction: "DOWN", quantity: 3 })).status).toBe(400);
        const res = await c.agent.post(url).send({ type: "ADJUSTMENT", direction: "DOWN", quantity: 3, reason: "Inventaire du 30/09 : 3 boîtes manquantes" });
        expect(res.status).toBe(201);
        expect(res.body.movement.delta).toBe(-3);
        expect(res.body.movement.stockBefore).toBe(10);
        expect(await qty(c)).toBe(7);
        const up = await c.agent.post(url).send({ type: "ADJUSTMENT", direction: "UP", quantity: 2, reason: "Inventaire : 2 boîtes retrouvées" });
        expect(up.body.movement.delta).toBe(2);
        expect(await qty(c)).toBe(9);
    });

    it("une correction ne peut pas rendre le stock négatif", async () => {
        const c = await ctx(2);
        const res = await c.agent.post(`/api/stocks/${c.stock._id}/movements`)
            .send({ type: "ADJUSTMENT", direction: "DOWN", quantity: 5, reason: "Erreur de comptage présumée" });
        expect(res.status).toBe(409);
        expect(await qty(c)).toBe(2);
    });

    it("perte et casse exigent une justification", async () => {
        const c = await ctx(10);
        const url = `/api/stocks/${c.stock._id}/movements`;
        expect((await c.agent.post(url).send({ type: "LOSS", quantity: 1 })).status).toBe(400);
        expect((await c.agent.post(url).send({ type: "BREAKAGE", quantity: 1, reason: "Chute en rayon" })).status).toBe(201);
        expect(await qty(c)).toBe(9);
    });

    it("entrée directe (IN) interdite : le stock n'augmente que par réception", async () => {
        const c = await ctx(0);
        const res = await c.agent.post(`/api/stocks/${c.stock._id}/movements`).send({ type: "IN", quantity: 50 });
        expect(res.status).toBe(400);
        expect(await qty(c)).toBe(0);
    });
});

describe("Alertes", () => {
    const evaluate = (c) => c.agent.post("/api/alerts/evaluate").send({ pharmacy: c.pharmacy._id });

    it("stock sous le seuil => alerte ; réévaluer ne crée pas de doublon", async () => {
        const c = await ctx(5); // seuil par défaut : 10
        const first = await evaluate(c);
        expect(first.body.alerts.map((a) => a.type)).toEqual(["LOW_STOCK"]);
        await evaluate(c);
        await evaluate(c);
        expect(await Alert.countDocuments()).toBe(1);
    });

    it("évaluations simultanées : toujours une seule alerte par incident", async () => {
        const c = await ctx(5);
        await Promise.all(Array.from({ length: 6 }, () => evaluate(c)));
        expect(await Alert.countDocuments({ dedupeKey: `LOW_STOCK:${c.stock._id}` })).toBe(1);
    });

    it("l'alerte se résout quand le stock remonte, et se rouvre (même document) s'il rechute", async () => {
        const c = await ctx(5);
        await evaluate(c);
        await deliver(c, { quantity: 20 });
        await evaluate(c);
        expect((await Alert.findOne()).status).toBe("RESOLVED");
        await sell(c, 20);
        await evaluate(c);
        expect(await Alert.countDocuments()).toBe(1);
        expect((await Alert.findOne()).status).toBe("OPEN");
    });

    it("rupture, lot proche de péremption et lot périmé sont signalés", async () => {
        const c = await ctx(0);
        const base = { stock: c.stock._id, pharmacy: c.pharmacy._id, medicine: c.medicine._id };
        await Lot.create({ ...base, lotNumber: "PROCHE", expiryDate: inDays(10), receivedQuantity: 3, remainingQuantity: 3 });
        await Stock.updateOne({ _id: c.stock._id }, { quantity: 3 });
        await Lot.create({ ...base, lotNumber: "ECHU", expiryDate: inDays(-2), receivedQuantity: 4, remainingQuantity: 4 });
        await Stock.updateOne({ _id: c.stock._id }, { quantity: 7 });
        const res = await evaluate(c);
        const types = res.body.alerts.map((a) => a.type);
        expect(types).toContain("LOT_EXPIRED");
        expect(types).toContain("LOT_NEAR_EXPIRY");
    });

    it("prise en compte d'une alerte, et cloisonnement entre pharmacies", async () => {
        const a = await ctx(5);
        const b = await ctx(5);
        const ev = await evaluate(a);
        const id = ev.body.alerts[0]._id;
        expect((await b.agent.post(`/api/alerts/${id}/acknowledge`)).status).toBe(404);
        expect((await b.agent.get(`/api/alerts?pharmacy=${a.pharmacy._id}`)).status).toBe(403);
        expect((await a.agent.post(`/api/alerts/${id}/acknowledge`)).status).toBe(200);
        expect((await a.agent.post(`/api/alerts/${id}/acknowledge`)).status).toBe(409);
    });
});

describe("Fournisseurs et commandes", () => {
    const makeSupplier = (c, name = "Fournisseur TEST") =>
        c.agent.post("/api/suppliers").send({ pharmacy: c.pharmacy._id, name });

    async function draft(c, supplierId, lines) {
        return c.agent.post("/api/purchase-orders").send({ pharmacy: c.pharmacy._id, supplier: supplierId, lines });
    }

    it("fournisseur : doublon refusé, invisible depuis une autre pharmacie", async () => {
        const a = await ctx(0);
        const b = await ctx(0);
        expect((await makeSupplier(a)).status).toBe(201);
        expect((await makeSupplier(a)).status).toBe(409);
        expect((await b.agent.get("/api/suppliers")).body).toHaveLength(0);
    });

    it("une commande n'augmente JAMAIS le stock et refuse le fournisseur d'une autre pharmacie", async () => {
        const a = await ctx(10);
        const b = await ctx(0);
        const sup = (await makeSupplier(a)).body.supplier;
        const res = await draft(a, sup._id, [{ stock: a.stock._id, quantity: 50 }]);
        expect(res.status).toBe(201);
        expect(res.body.order.status).toBe("DRAFT");
        expect(await qty(a)).toBe(10);
        const foreign = await draft(b, sup._id, [{ stock: b.stock._id, quantity: 5 }]);
        expect(foreign.status).toBe(404);
    });

    it("workflow : un pharmacien soumet, seul le responsable approuve et envoie, pas de saut d'étape", async () => {
        const c = await ctx(10);
        const p = await pharmacistOf(c);
        const sup = (await makeSupplier(c)).body.supplier;
        const id = (await draft(c, sup._id, [{ stock: c.stock._id, quantity: 50 }])).body.order._id;
        const go = (agent, to, reason) => agent.post(`/api/purchase-orders/${id}/transition`).send({ to, reason });

        expect((await go(p.agent, "SENT")).status).toBe(409);               // pas d'envoi d'un brouillon
        expect((await go(p.agent, "PENDING_APPROVAL")).status).toBe(200);
        expect((await go(p.agent, "APPROVED")).status).toBe(403);           // responsable uniquement
        expect((await go(c.agent, "APPROVED")).status).toBe(200);
        expect((await go(c.agent, "SENT")).status).toBe(200);
        expect((await go(c.agent, "DRAFT")).status).toBe(409);
        expect((await go(c.agent, "CANCELLED")).status).toBe(400);          // motif obligatoire
        expect((await go(c.agent, "CANCELLED", "Fournisseur en rupture")).status).toBe(200);
        expect(await qty(c)).toBe(10);
    });

    it("réception rattachée : partielle puis terminée, quantités réellement reçues seulement", async () => {
        const c = await ctx(0);
        const sup = (await makeSupplier(c)).body.supplier;
        const id = (await draft(c, sup._id, [{ stock: c.stock._id, quantity: 10 }])).body.order._id;
        const go = (to) => c.agent.post(`/api/purchase-orders/${id}/transition`).send({ to });

        // Livraison rattachée à une commande non envoyée : refusée, stock intact.
        const early = await deliver(c, { quantity: 4, purchaseOrder: id });
        expect(early.status).toBe(409);
        expect(early.body.code).toBe("ORDER_NOT_RECEIVABLE");
        expect(await qty(c)).toBe(0);

        await go("PENDING_APPROVAL"); await go("APPROVED"); await go("SENT");
        const part = await deliver(c, { quantity: 4, purchaseOrder: id });
        expect(part.status).toBe(201);
        expect(part.body.purchaseOrder.status).toBe("PARTIALLY_RECEIVED");
        expect(await qty(c)).toBe(4);

        const rest = await deliver(c, { quantity: 6, purchaseOrder: id });
        expect(rest.body.purchaseOrder.status).toBe("RECEIVED");
        expect(rest.body.purchaseOrder.overDelivery).toBe(false);
        expect(await qty(c)).toBe(10);
    });

    it("livraison rejouée (même clé) : la commande n'est comptée qu'une fois", async () => {
        const c = await ctx(0);
        const sup = (await makeSupplier(c)).body.supplier;
        const id = (await draft(c, sup._id, [{ stock: c.stock._id, quantity: 10 }])).body.order._id;
        for (const to of ["PENDING_APPROVAL", "APPROVED", "SENT"]) await c.agent.post(`/api/purchase-orders/${id}/transition`).send({ to });
        await deliver(c, { quantity: 4, purchaseOrder: id }, "livraison-po-0001");
        await deliver(c, { quantity: 4, purchaseOrder: id }, "livraison-po-0001");
        expect((await PurchaseOrder.findById(id)).lines[0].quantityReceived).toBe(4);
        expect(await qty(c)).toBe(4);
    });

    it("produit inattendu : refusé si absent de la commande", async () => {
        const c = await ctx(0);
        const other = await addStock(c.pharmacy, 0);
        const sup = (await makeSupplier(c)).body.supplier;
        const id = (await draft(c, sup._id, [{ stock: c.stock._id, quantity: 10 }])).body.order._id;
        for (const to of ["PENDING_APPROVAL", "APPROVED", "SENT"]) await c.agent.post(`/api/purchase-orders/${id}/transition`).send({ to });
        const res = await c.agent.post("/api/deliveries").send({ pharmacy: c.pharmacy._id, medicine: other.medicine._id, quantity: 3, purchaseOrder: id });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("PRODUCT_NOT_ON_ORDER");
    });

    it("commande d'une autre pharmacie : introuvable", async () => {
        const a = await ctx(0);
        const b = await ctx(0);
        const sup = (await makeSupplier(a)).body.supplier;
        const id = (await draft(a, sup._id, [{ stock: a.stock._id, quantity: 10 }])).body.order._id;
        expect((await b.agent.get(`/api/purchase-orders/${id}`)).status).toBe(404);
        expect((await b.agent.post(`/api/purchase-orders/${id}/transition`).send({ to: "PENDING_APPROVAL" })).status).toBe(404);
    });
});

describe("Réapprovisionnement", () => {
    const setup = async (c, patch) => c.agent.patch(`/api/stocks/${c.stock._id}`).send(patch);
    const suggestions = async (c, all = false) =>
        (await c.agent.get(`/api/replenishment/suggestions?all=${all}`)).body.suggestions;

    it("calcule cible - disponible, arrondi au conditionnement", async () => {
        const c = await ctx(30);
        await setup(c, { targetQuantity: 100, packSize: 12 });
        const [s] = await suggestions(c);
        expect(s.suggestion.quantity).toBe(72); // 70 -> 72 (multiple de 12)
        expect(s.suggestion.reason).toBe("REPLENISH");
    });

    it("tient compte des commandes en cours (et seulement des engagées)", async () => {
        const c = await ctx(30);
        await setup(c, { targetQuantity: 100, packSize: 12 });
        const sup = (await c.agent.post("/api/suppliers").send({ pharmacy: c.pharmacy._id, name: "Fournisseur F" })).body.supplier;
        const id = (await c.agent.post("/api/purchase-orders").send({
            pharmacy: c.pharmacy._id, supplier: sup._id, lines: [{ stock: c.stock._id, quantity: 30 }]
        })).body.order._id;

        expect((await suggestions(c))[0].onOrder).toBe(0);   // brouillon : pas encore commandé
        for (const to of ["PENDING_APPROVAL", "APPROVED", "SENT"]) await c.agent.post(`/api/purchase-orders/${id}/transition`).send({ to });
        const [s] = await suggestions(c);
        expect(s.onOrder).toBe(30);
        expect(s.suggestion.quantity).toBe(48); // 100 - 30 - 30 = 40 -> 48
    });

    it("sans stock cible ni historique : pas de suggestion inventée", async () => {
        const c = await ctx(5);
        expect(await suggestions(c)).toHaveLength(0);
        const [s] = await suggestions(c, true);
        expect(s.suggestion.reason).toBe("INSUFFICIENT_DATA");
        expect(s.limits).toMatch(/stock cible/);
    });

    it("le brouillon généré utilise les quantités calculées par le serveur", async () => {
        const c = await ctx(30);
        await setup(c, { targetQuantity: 100, packSize: 12 });
        const sup = (await c.agent.post("/api/suppliers").send({ pharmacy: c.pharmacy._id, name: "Fournisseur F" })).body.supplier;
        const res = await c.agent.post("/api/purchase-orders/from-suggestions")
            .send({ pharmacy: c.pharmacy._id, supplier: sup._id, stockIds: [c.stock._id] });
        expect(res.status).toBe(201);
        expect(res.body.order.lines[0].quantityOrdered).toBe(72);
        expect(res.body.order.source).toBe("REPLENISHMENT");
        expect(res.body.order.status).toBe("DRAFT");
        expect(await qty(c)).toBe(30);
    });

    it("rien à commander : refus explicite", async () => {
        const c = await ctx(200);
        await setup(c, { targetQuantity: 100 });
        const sup = (await c.agent.post("/api/suppliers").send({ pharmacy: c.pharmacy._id, name: "Fournisseur F" })).body.supplier;
        const res = await c.agent.post("/api/purchase-orders/from-suggestions")
            .send({ pharmacy: c.pharmacy._id, supplier: sup._id, stockIds: [c.stock._id] });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("NOTHING_TO_ORDER");
    });
});

describe("Cohérence sous concurrence avec des lots", () => {
    it("20 ventes simultanées sur 10 unités réparties en 2 lots : 10 réussissent, aucun négatif, lots cohérents", async () => {
        const c = await ctx(0);
        await deliver(c, { quantity: 5, lotNumber: "A", expiryDate: inDays(100) });
        await deliver(c, { quantity: 5, lotNumber: "B", expiryDate: inDays(200) });
        const results = await Promise.all(Array.from({ length: 20 }, () => sell(c, 1)));
        expect(results.filter((r) => r.status === 201)).toHaveLength(10);
        expect(await qty(c)).toBe(0);
        const lots = await Lot.find();
        expect(lots.reduce((s, l) => s + l.remainingQuantity, 0)).toBe(0);
        const summary = (await c.agent.get(`/api/stocks/${c.stock._id}/summary`)).body;
        expect(summary.consistent).toBe(true);
    });

    it("ventes simultanées avec clés d'idempotence distinctes : somme des lots = stock disponible", async () => {
        const c = await ctx(0);
        await deliver(c, { quantity: 30, lotNumber: "A", expiryDate: inDays(100) });
        await Promise.all(Array.from({ length: 12 }, (_, i) => sell(c, 2, `vente-concurrente-${i}-xyz`)));
        const summary = (await c.agent.get(`/api/stocks/${c.stock._id}/summary`)).body;
        expect(summary.available).toBe(6);
        expect(summary.inLots).toBe(6);
        expect(summary.consistent).toBe(true);
    });
});
