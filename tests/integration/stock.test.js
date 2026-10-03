import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import {
    startTestDb, stopTestDb, resetDb, seedStock, loginAs,
    Stock, StockMovement, Delivery
} from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

// Stock de test + responsable de cette pharmacie, connecté.
async function ctx(quantity) {
    const s = await seedStock(quantity);
    const { agent, user } = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
    return { ...s, agent, user };
}

const move = (agent, id, body, key) => {
    const r = agent.post(`/api/stocks/${id}/movements`);
    if (key) r.set("Idempotency-Key", key);
    return r.send(body);
};

describe("Mouvements de stock", () => {
    it("vente autorisée : décrémente, trace avant/après et l'utilisateur", async () => {
        const { stock, agent, user } = await ctx(10);
        const res = await move(agent, stock._id, { type: "OUT", quantity: 4, reason: "Vente" });
        expect(res.status).toBe(201);
        expect(res.body.movement.stockBefore).toBe(10);
        expect(res.body.movement.stockAfter).toBe(6);
        expect(String(res.body.movement.performedBy)).toBe(String(user._id));
        expect((await Stock.findById(stock._id)).quantity).toBe(6);
    });

    it("sortie supérieure au stock : rejetée, stock intact, trace REJECTED conservée", async () => {
        const { stock, agent } = await ctx(3);
        const res = await move(agent, stock._id, { type: "OUT", quantity: 5 });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("INSUFFICIENT_STOCK");
        expect((await Stock.findById(stock._id)).quantity).toBe(3);
        expect(await StockMovement.countDocuments({ stock: stock._id, status: "REJECTED" })).toBe(1);
    });

    it("même clé d'idempotence rejouée : appliquée une seule fois", async () => {
        const { stock, agent } = await ctx(10);
        const a = await move(agent, stock._id, { type: "OUT", quantity: 2 }, "cle-unique-001");
        const b = await move(agent, stock._id, { type: "OUT", quantity: 2 }, "cle-unique-001");
        expect(a.status).toBe(201);
        expect(b.status).toBe(200);
        expect(b.body.replayed).toBe(true);
        expect((await Stock.findById(stock._id)).quantity).toBe(8);
    });

    it("même clé avec une autre quantité : conflit, rien appliqué", async () => {
        const { stock, agent } = await ctx(10);
        await move(agent, stock._id, { type: "OUT", quantity: 2 }, "cle-unique-002");
        const res = await move(agent, stock._id, { type: "OUT", quantity: 5 }, "cle-unique-002");
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("IDEMPOTENCY_CONFLICT");
        expect((await Stock.findById(stock._id)).quantity).toBe(8);
    });

    it("deux ventes simultanées sur la dernière unité : une seule réussit", async () => {
        const { stock, agent } = await ctx(1);
        const results = await Promise.all([
            move(agent, stock._id, { type: "OUT", quantity: 1 }),
            move(agent, stock._id, { type: "OUT", quantity: 1 })
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
        expect((await Stock.findById(stock._id)).quantity).toBe(0);
    });

    it("20 ventes simultanées sur 5 unités : exactement 5 réussissent, jamais de stock négatif", async () => {
        const { stock, agent } = await ctx(5);
        const results = await Promise.all(
            Array.from({ length: 20 }, () => move(agent, stock._id, { type: "OUT", quantity: 1 }))
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(5);
        expect((await Stock.findById(stock._id)).quantity).toBe(0);
        expect(await StockMovement.countDocuments({ stock: stock._id, status: "APPLIED" })).toBe(5);
    });

    it("la même requête envoyée 10 fois en parallèle avec la même clé : appliquée une fois", async () => {
        const { stock, agent } = await ctx(50);
        const results = await Promise.all(
            Array.from({ length: 10 }, () => move(agent, stock._id, { type: "OUT", quantity: 1 }, "cle-parallele-1"))
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect((await Stock.findById(stock._id)).quantity).toBe(49);
    });

    it("PATCH ne peut plus contourner la traçabilité", async () => {
        const { stock, agent } = await ctx(10);
        const res = await agent.patch(`/api/stocks/${stock._id}`).send({ minimumQuantity: 3, quantity: 999 });
        expect(res.status).toBe(400);
        expect((await Stock.findById(stock._id)).quantity).toBe(10);
    });

    it("un stock avec historique ne peut pas être supprimé", async () => {
        const { stock, agent } = await ctx(10);
        await move(agent, stock._id, { type: "OUT", quantity: 1 });
        const res = await agent.delete(`/api/stocks/${stock._id}`);
        expect(res.status).toBe(409);
        expect(await Stock.exists({ _id: stock._id })).toBeTruthy();
    });

    it("stock initial à la création : passe par un mouvement traçable", async () => {
        const { pharmacy, medicine, agent } = await ctx(0);
        await Stock.deleteMany({});
        const res = await agent.post("/api/stocks")
            .send({ pharmacy: pharmacy._id, medicine: medicine._id, quantity: 25 });
        expect(res.status).toBe(201);
        expect(res.body.stock.quantity).toBe(25);
        expect(res.body.movement.reason).toBe("Stock initial");
    });
});

describe("Cloisonnement entre pharmacies", () => {
    it("un pharmacien ne voit, ne lit et ne modifie pas le stock d'une autre pharmacie", async () => {
        const a = await ctx(10);
        const b = await ctx(10); // autre pharmacie, autre stock
        // b tente d'agir sur le stock de a
        expect((await b.agent.get(`/api/stocks/${a.stock._id}`)).status).toBe(404);
        expect((await b.agent.get(`/api/stocks/${a.stock._id}/movements`)).status).toBe(404);
        expect((await move(b.agent, a.stock._id, { type: "OUT", quantity: 1 })).status).toBe(404);
        expect((await b.agent.patch(`/api/stocks/${a.stock._id}`).send({ minimumQuantity: 1 })).status).toBe(404);
        expect((await b.agent.delete(`/api/stocks/${a.stock._id}`)).status).toBe(404);
        expect((await Stock.findById(a.stock._id)).quantity).toBe(10);
    });

    it("la liste des stocks ne contient que ceux de ses pharmacies", async () => {
        const a = await ctx(10);
        await ctx(7);
        const res = await a.agent.get("/api/stocks");
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(String(res.body[0]._id)).toBe(String(a.stock._id));
        expect(res.headers["x-total-count"]).toBe("1");
    });

    it("livraison vers une autre pharmacie refusée, et liste des livraisons cloisonnée", async () => {
        const a = await ctx(0);
        const b = await ctx(0);
        const attempt = await b.agent.post("/api/deliveries")
            .send({ pharmacy: a.pharmacy._id, medicine: a.medicine._id, quantity: 10 });
        expect(attempt.status).toBe(403);
        expect((await Stock.findById(a.stock._id)).quantity).toBe(0);

        await a.agent.post("/api/deliveries").send({ pharmacy: a.pharmacy._id, medicine: a.medicine._id, quantity: 10 });
        expect((await a.agent.get("/api/deliveries")).body).toHaveLength(1);
        expect((await b.agent.get("/api/deliveries")).body).toHaveLength(0);
    });

    it("une clé d'idempotence d'une autre pharmacie ne révèle pas sa livraison", async () => {
        const a = await ctx(0);
        const b = await ctx(0);
        await a.agent.post("/api/deliveries").set("Idempotency-Key", "cle-livraison-a1")
            .send({ pharmacy: a.pharmacy._id, medicine: a.medicine._id, quantity: 10 });
        const res = await b.agent.post("/api/deliveries").set("Idempotency-Key", "cle-livraison-a1")
            .send({ pharmacy: b.pharmacy._id, medicine: b.medicine._id, quantity: 10 });
        expect(res.status).toBe(409);
        expect(res.body.delivery).toBeUndefined();
    });

    it("un administrateur de plateforme ne lit pas les stocks privés", async () => {
        const a = await ctx(10);
        const admin = await loginAs(app, request, "admin", []);
        expect((await admin.agent.get("/api/stocks")).status).toBe(403);
        expect((await admin.agent.get(`/api/stocks/${a.stock._id}`)).status).toBe(403);
    });
});

describe("Livraisons", () => {
    const body = (s, quantity = 20) => ({ pharmacy: s.pharmacy._id, medicine: s.medicine._id, quantity, supplier: "Fournisseur TEST" });

    it("livraison : stock augmenté + mouvement IN lié à la livraison", async () => {
        const s = await ctx(5);
        const res = await s.agent.post("/api/deliveries").send(body(s));
        expect(res.status).toBe(201);
        expect(res.body.stock.quantityBefore).toBe(5);
        expect(res.body.stock.quantityAfter).toBe(25);
        expect(String(res.body.movement.delivery)).toBe(String(res.body.delivery._id));
    });

    it("double envoi de la même livraison (même clé) : stock augmenté une seule fois", async () => {
        const s = await ctx(0);
        const send = () => s.agent.post("/api/deliveries").set("Idempotency-Key", "livraison-2026-001").send(body(s));
        const first = await send();
        const second = await send();
        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(second.body.replayed).toBe(true);
        expect((await Stock.findById(s.stock._id)).quantity).toBe(20);
        expect(await Delivery.countDocuments()).toBe(1);
    });

    it("livraison identique envoyée 8 fois en parallèle : une seule appliquée", async () => {
        const s = await ctx(0);
        const results = await Promise.all(Array.from({ length: 8 }, () =>
            s.agent.post("/api/deliveries").set("Idempotency-Key", "livraison-parallele").send(body(s))
        ));
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect((await Stock.findById(s.stock._id)).quantity).toBe(20);
        expect(await Delivery.countDocuments()).toBe(1);
    });

    it("livraison sans stock existant : 404, aucune livraison créée", async () => {
        const s = await ctx(0);
        await Stock.deleteMany({});
        const res = await s.agent.post("/api/deliveries").send(body(s));
        expect(res.status).toBe(404);
        expect(await Delivery.countDocuments()).toBe(0);
    });
});
