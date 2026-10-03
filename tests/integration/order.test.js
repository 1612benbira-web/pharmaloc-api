import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import {
    startTestDb, stopTestDb, resetDb, seedStock, addStock, loginAs, inDays,
    Stock, Medicine, Lot, Order, Payment
} from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

// Pharmacie + stock avec prix + un patient + un responsable de cette pharmacie.
async function shop(quantity = 10, price = 1500) {
    const s = await seedStock(quantity);
    await Stock.updateOne({ _id: s.stock._id }, { price });
    const patient = await loginAs(app, request, "patient");
    const staff = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
    return { ...s, patient, staff };
}

const orderBody = (s, quantity = 2, extra = {}) => ({
    pharmacy: String(s.pharmacy._id),
    items: [{ medicine: String(s.medicine._id), quantity }],
    fulfillment: "PICKUP",
    ...extra
});

const placeOrder = (s, quantity = 2, extra = {}) => s.patient.agent.post("/api/orders").send(orderBody(s, quantity, extra));
const qty = async (s) => (await Stock.findById(s.stock._id)).quantity;
const past = () => new Date(Date.now() - 1000);

describe("Création de commande", () => {
    it("prix calculé côté serveur (le prix envoyé est ignoré) et stock réservé", async () => {
        const s = await shop(10, 1500);
        const res = await s.patient.agent.post("/api/orders").send({
            ...orderBody(s, 2), total: 1, items: [{ medicine: String(s.medicine._id), quantity: 2, unitPrice: 1 }]
        });
        expect(res.status).toBe(201);
        expect(res.body.order.items[0].unitPrice).toBe(1500);
        expect(res.body.order.total).toBe(3000);
        expect(res.body.order.status).toBe("PAYMENT_PENDING");
        expect(res.body.order.stockReserved).toBe(true);
        expect(await qty(s)).toBe(8);
    });

        it("livraison : frais ajoutés, adresse et téléphone obligatoires", async () => {
        const s = await shop(10, 1000);
        expect((await placeOrder(s, 1, { fulfillment: "DELIVERY" })).status).toBe(400);
        expect((await placeOrder(s, 1, { fulfillment: "DELIVERY", deliveryAddress: "Pikine, Dakar" })).status).toBe(400);
        const res = await placeOrder(s, 1, { fulfillment: "DELIVERY", deliveryAddress: "Pikine, Dakar", contactPhone: "770000011" });
        expect(res.status).toBe(201);
        expect(res.body.order.deliveryFee).toBe(750);
        expect(res.body.order.total).toBe(1750);
    });

    it("stock insuffisant : refusé, aucune commande créée, stock intact", async () => {
        const s = await shop(3);
        const res = await placeOrder(s, 5);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("INSUFFICIENT_STOCK");
        expect(await Order.countDocuments()).toBe(0);
        expect(await qty(s)).toBe(3);
    });

    it("commande à plusieurs lignes dont une échoue : tout est remis en stock", async () => {
        const s = await shop(10);
        const b = await addStock(s.pharmacy, 1, "Produit B");
        await Stock.updateOne({ _id: b.stock._id }, { price: 800 });
        const res = await s.patient.agent.post("/api/orders").send({
            pharmacy: String(s.pharmacy._id),
            items: [
                { medicine: String(s.medicine._id), quantity: 2 },
                { medicine: String(b.medicine._id), quantity: 5 }
            ],
            fulfillment: "PICKUP"
        });
        expect(res.status).toBe(409);
        expect(await qty(s)).toBe(10);
        expect(await Order.countDocuments()).toBe(0);
    });

    it("20 commandes simultanées sur 5 unités : exactement 5 réussissent, jamais de stock négatif", async () => {
        const s = await shop(5);
        const results = await Promise.all(Array.from({ length: 20 }, () => placeOrder(s, 1)));
        expect(results.filter((r) => r.status === 201)).toHaveLength(5);
        expect(await qty(s)).toBe(0);
        expect(await Order.countDocuments()).toBe(5);
    });

    it("produit sans prix : refusé", async () => {
        const s = await shop(10);
        await Stock.updateOne({ _id: s.stock._id }, { $unset: { price: 1 } });
        const res = await placeOrder(s, 1);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("PRICE_NOT_SET");
    });

    it("médicament sur ordonnance : refusé", async () => {
        const s = await shop(10);
        await Medicine.updateOne({ _id: s.medicine._id }, { prescriptionRequired: true });
        const res = await placeOrder(s, 1);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("PRESCRIPTION_REQUIRED");
        expect(await qty(s)).toBe(10);
    });

    it("doublon de médicament dans la commande et quantité nulle : refusés", async () => {
        const s = await shop(10);
        const id = String(s.medicine._id);
        const dup = await s.patient.agent.post("/api/orders").send({
            pharmacy: String(s.pharmacy._id), fulfillment: "PICKUP",
            items: [{ medicine: id, quantity: 1 }, { medicine: id, quantity: 1 }]
        });
        expect(dup.status).toBe(400);
        expect((await placeOrder(s, 0)).status).toBe(400);
    });

    it("seul un patient connecté peut commander", async () => {
        const s = await shop(10);
        expect((await request(app).post("/api/orders").send(orderBody(s))).status).toBe(401);
        expect((await s.staff.agent.post("/api/orders").send(orderBody(s))).status).toBe(403);
    });

    it("même clé d'idempotence : une seule commande, stock réservé une seule fois", async () => {
        const s = await shop(10);
        const send = () => s.patient.agent.post("/api/orders").set("Idempotency-Key", "commande-2026-001").send(orderBody(s, 2));
        const first = await send();
        const second = await send();
        expect(first.status).toBe(201);
        expect(second.status).toBe(200);
        expect(second.body.replayed).toBe(true);
        expect(await Order.countDocuments()).toBe(1);
        expect(await qty(s)).toBe(8);
    });

    it("même clé envoyée 6 fois en parallèle : une seule commande créée", async () => {
        const s = await shop(10);
        const results = await Promise.all(Array.from({ length: 6 }, () =>
            s.patient.agent.post("/api/orders").set("Idempotency-Key", "commande-parallele").send(orderBody(s, 2))
        ));
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect(await Order.countDocuments()).toBe(1);
        expect(await qty(s)).toBe(8);
    });
});

describe("Annulation et expiration", () => {
    it("le patient annule : statut CANCELLED, stock remis en vente, pas de double annulation", async () => {
        const s = await shop(10);
        const { body } = await placeOrder(s, 4);
        expect(await qty(s)).toBe(6);
        const res = await s.patient.agent.post(`/api/orders/${body.order._id}/cancel`);
        expect(res.status).toBe(200);
        expect(res.body.order.status).toBe("CANCELLED");
        expect(await qty(s)).toBe(10);
        expect((await s.patient.agent.post(`/api/orders/${body.order._id}/cancel`)).status).toBe(409);
        expect(await qty(s)).toBe(10);
    });

    it("un autre patient ne peut pas annuler la commande", async () => {
        const s = await shop(10);
        const { body } = await placeOrder(s, 1);
        const other = await loginAs(app, request, "patient");
        expect((await other.agent.post(`/api/orders/${body.order._id}/cancel`)).status).toBe(404);
        expect(await qty(s)).toBe(9);
    });

    it("annulation avec des lots : le lot ET le stock retrouvent leurs unités", async () => {
        const s = await shop(0);
        const received = await s.staff.agent.post("/api/deliveries").send({
            pharmacy: String(s.pharmacy._id), medicine: String(s.medicine._id), quantity: 5,
            lotNumber: "L1", expiryDate: inDays(90).toISOString()
        });
        expect(received.status).toBe(201);

        const { body } = await placeOrder(s, 3);
        expect((await Lot.findOne({ lotNumber: "L1" })).remainingQuantity).toBe(2);
        expect(await qty(s)).toBe(2);

        await s.patient.agent.post(`/api/orders/${body.order._id}/cancel`);
        expect((await Lot.findOne({ lotNumber: "L1" })).remainingQuantity).toBe(5);
        expect(await qty(s)).toBe(5);
    });

    it("commande non payée à l'échéance : elle expire et le stock est remis en vente", async () => {
        const s = await shop(10);
        const { body } = await placeOrder(s, 3);
        await Order.updateOne({ _id: body.order._id }, { reservationExpiresAt: past() });

        const list = await s.patient.agent.get("/api/orders/mine");
        expect(list.status).toBe(200);
        expect(list.body[0].status).toBe("EXPIRED");
        expect(await qty(s)).toBe(10);
    });
});

describe("Lecture et cloisonnement", () => {
    it("le patient ne voit que ses commandes ; un autre patient reçoit 404", async () => {
        const s = await shop(10);
        const { body } = await placeOrder(s, 1);
        const other = await loginAs(app, request, "patient");

        expect((await s.patient.agent.get("/api/orders/mine")).body).toHaveLength(1);
        expect((await other.agent.get("/api/orders/mine")).body).toHaveLength(0);
        expect((await other.agent.get(`/api/orders/${body.order._id}`)).status).toBe(404);
        expect((await s.patient.agent.get(`/api/orders/${body.order._id}`)).status).toBe(200);
    });

    it("le personnel voit les commandes de sa pharmacie seulement ; l'admin n'y a pas accès", async () => {
        const a = await shop(10);
        const b = await shop(10);
        const { body } = await placeOrder(a, 1);
        const admin = await loginAs(app, request, "admin", []);

        expect((await a.staff.agent.get(`/api/orders/${body.order._id}`)).status).toBe(200);
        expect((await a.staff.agent.get("/api/orders/pharmacy")).body).toHaveLength(1);
        expect((await b.staff.agent.get(`/api/orders/${body.order._id}`)).status).toBe(404);
        expect((await b.staff.agent.get("/api/orders/pharmacy")).body).toHaveLength(0);
        expect((await admin.agent.get(`/api/orders/${body.order._id}`)).status).toBe(404);
        expect((await admin.agent.get("/api/orders/pharmacy")).status).toBe(403);
    });
});

describe("Paiement", () => {
    async function ordered(quantity = 10) {
        const s = await shop(quantity);
        const { body } = await placeOrder(s, 2);
        const admin = await loginAs(app, request, "admin", []);
        const pay = (method = "WAVE", key) => {
            const r = s.patient.agent.post("/api/payments");
            if (key) r.set("Idempotency-Key", key);
            return r.send({ orderId: body.order._id, method });
        };
        const settle = (paymentId, outcome) => admin.agent.post(`/api/payments/${paymentId}/simulate`).send({ outcome });
        return { ...s, order: body.order, admin, pay, settle };
    }

    it("démarrer un paiement : le montant vient de la commande, statut PROCESSING", async () => {
        const s = await ordered();
        const res = await s.pay("WAVE");
        expect(res.status).toBe(201);
        expect(res.body.payment.amount).toBe(3000);
        expect(res.body.payment.status).toBe("PROCESSING");
        expect(res.body.payment.transactionId).toBeTruthy();
        expect(await Payment.countDocuments()).toBe(1);
    });

    it("moyen de paiement inconnu : refusé ; commande d'un autre patient : 404", async () => {
        const s = await ordered();
        expect((await s.pay("BITCOIN")).status).toBe(400);
        const other = await loginAs(app, request, "patient");
        const res = await other.agent.post("/api/payments").send({ orderId: s.order._id, method: "WAVE" });
        expect(res.status).toBe(404);
    });

    it("deux paiements pour la même commande : un seul est ouvert", async () => {
        const s = await ordered();
        expect((await s.pay("WAVE")).status).toBe(201);
        const second = await s.pay("ORANGE_MONEY");
        expect(second.status).toBe(409);
        expect(second.body.code).toBe("PAYMENT_ALREADY_STARTED");
    });

    it("5 paiements simultanés pour la même commande : un seul créé", async () => {
        const s = await ordered();
        const results = await Promise.all(Array.from({ length: 5 }, () => s.pay("WAVE")));
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect(await Payment.countDocuments()).toBe(1);
    });

    it("même clé d'idempotence rejouée : un seul paiement", async () => {
        const s = await ordered();
        const a = await s.pay("WAVE", "paiement-2026-001");
        const b = await s.pay("WAVE", "paiement-2026-001");
        expect(a.status).toBe(201);
        expect(b.status).toBe(200);
        expect(b.body.replayed).toBe(true);
        expect(await Payment.countDocuments()).toBe(1);
    });

    it("paiement réussi : la commande passe à CONFIRMED ; un résultat rejoué ne change rien", async () => {
        const s = await ordered();
        const { body } = await s.pay("WAVE");
        const done = await s.settle(body.payment._id, "PAID");
        expect(done.status).toBe(200);
        expect(done.body.payment.status).toBe("PAID");
        expect(done.body.payment.paidAt).toBeTruthy();
        expect((await Order.findById(s.order._id)).status).toBe("CONFIRMED");

        const replay = await s.settle(body.payment._id, "FAILED");
        expect(replay.body.replayed).toBe(true);
        expect(replay.body.payment.status).toBe("PAID");
        expect((await Order.findById(s.order._id)).status).toBe("CONFIRMED");
    });

    it("paiement échoué : la commande reste payable et un nouvel essai est possible", async () => {
        const s = await ordered();
        const { body } = await s.pay("WAVE");
        await s.settle(body.payment._id, "FAILED");
        expect((await Order.findById(s.order._id)).status).toBe("PAYMENT_PENDING");
        expect((await s.pay("ORANGE_MONEY")).status).toBe(201);
    });

    it("seul un administrateur peut simuler un résultat", async () => {
        const s = await ordered();
        const { body } = await s.pay("WAVE");
        const res = await s.patient.agent.post(`/api/payments/${body.payment._id}/simulate`).send({ outcome: "PAID" });
        expect(res.status).toBe(403);
        expect((await Order.findById(s.order._id)).status).toBe("PAYMENT_PENDING");
    });

    it("commande expirée : paiement refusé et stock remis en vente", async () => {
        const s = await ordered();
        await Order.updateOne({ _id: s.order._id }, { reservationExpiresAt: past() });
        const res = await s.pay("WAVE");
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("ORDER_EXPIRED");
        expect(await qty(s)).toBe(10);
        expect(await Payment.countDocuments()).toBe(0);
    });

    it("paiement reçu après expiration de la commande : signalé pour remboursement", async () => {
        const s = await ordered();
        const { body } = await s.pay("WAVE");
        await Order.updateOne({ _id: s.order._id }, { status: "EXPIRED" });
        const done = await s.settle(body.payment._id, "PAID");
        expect(done.body.payment.needsReview).toBe(true);
        expect((await Order.findById(s.order._id)).status).toBe("EXPIRED");
    });

    it("annulation impossible quand un paiement est en cours", async () => {
        const s = await ordered();
        await s.pay("WAVE");
        const res = await s.patient.agent.post(`/api/orders/${s.order._id}/cancel`);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("PAYMENT_IN_PROGRESS");
        expect(await qty(s)).toBe(8);
    });
});

describe("Préparation par la pharmacie", () => {
    async function paid(extra = {}) {
        const s = await shop(10);
        const { body } = await placeOrder(s, 2, extra);
        const admin = await loginAs(app, request, "admin", []);
        const pay = await s.patient.agent.post("/api/payments").send({ orderId: body.order._id, method: "WAVE" });
        await admin.agent.post(`/api/payments/${pay.body.payment._id}/simulate`).send({ outcome: "PAID" });
        const setStatus = (status, agent = s.staff.agent) => agent.patch(`/api/orders/${body.order._id}/status`).send({ status });
        return { ...s, order: body.order, setStatus };
    }

    it("retrait : CONFIRMED, PREPARING, READY, COMPLETED, sans saut d'étape", async () => {
        const s = await paid();
        expect((await s.setStatus("READY")).status).toBe(409);
        expect((await s.setStatus("PREPARING")).status).toBe(200);
        expect((await s.setStatus("READY")).status).toBe(200);
        expect((await s.setStatus("COMPLETED")).status).toBe(200);
        expect((await s.setStatus("PREPARING")).status).toBe(409);
    });

        it("livraison : le personnel prépare, mais ne remet ni ne clôt la livraison à la place du livreur", async () => {
        const s = await paid({ fulfillment: "DELIVERY", deliveryAddress: "Pikine, Dakar", contactPhone: "770000011" });
        expect((await s.setStatus("PREPARING")).status).toBe(200);
        expect((await s.setStatus("READY")).status).toBe(200);
        const handover = await s.setStatus("OUT_FOR_DELIVERY");
        expect(handover.status).toBe(409);
        expect(handover.body.code).toBe("MANAGED_BY_SHIPMENT");
        expect((await s.setStatus("COMPLETED")).status).toBe(409);
    });

    it("le patient ne peut pas faire avancer sa commande ; une autre pharmacie non plus", async () => {
        const s = await paid();
        expect((await s.setStatus("PREPARING", s.patient.agent)).status).toBe(403);
        const other = await shop(10);
        expect((await s.setStatus("PREPARING", other.staff.agent)).status).toBe(404);
        expect((await Order.findById(s.order._id)).status).toBe("CONFIRMED");
    });

    it("une commande non payée ne peut pas être préparée", async () => {
        const s = await shop(10);
        const { body } = await placeOrder(s, 1);
        const res = await s.staff.agent.patch(`/api/orders/${body.order._id}/status`).send({ status: "PREPARING" });
        expect(res.status).toBe(409);
    });
});