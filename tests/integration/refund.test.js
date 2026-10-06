import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, loginAs, Stock, Order, Payment, Shipment } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

// Commande de 2 unités, payée (ou seulement lancée), avec patient, responsable de la pharmacie et admin.
async function setup(fulfillment = "PICKUP", { settle = true } = {}) {
    const s = await seedStock(10);
    await Stock.updateOne({ _id: s.stock._id }, { price: 1000 });
    const patient = await loginAs(app, request, "patient");
    const manager = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
    const admin = await loginAs(app, request, "admin", []);
    const created = await patient.agent.post("/api/orders").send({
        pharmacy: String(s.pharmacy._id), fulfillment, items: [{ medicine: String(s.medicine._id), quantity: 2 }],
        ...(fulfillment === "DELIVERY" ? { deliveryAddress: "Pikine, Dakar", contactPhone: "770000011" } : {})
    });
    const orderId = created.body.order._id;
    const pay = await patient.agent.post("/api/payments").send({ orderId, method: "WAVE" });
    const paymentId = pay.body.payment._id;
    if (settle) await admin.agent.post(`/api/payments/${paymentId}/simulate`).send({ outcome: "PAID" });
    const setStatus = (to) => manager.agent.patch(`/api/orders/${orderId}/status`).send({ status: to });
    return { ...s, patient, manager, admin, orderId, paymentId, setStatus };
}

const cancel = (agent, orderId, reason = "Le client a changé d'avis") =>
    agent.post(`/api/orders/${orderId}/cancel-paid`).send({ reason });
const qty = async (s) => (await Stock.findById(s.stock._id)).quantity;

describe("Annulation d'une commande payée", () => {
    it("le responsable annule : produits remis en stock, client remboursé, motif conservé", async () => {
        const s = await setup();
        expect(await qty(s)).toBe(8);
        const res = await cancel(s.manager.agent, s.orderId);
        expect(res.status).toBe(200);
        expect(res.body.refund.status).toBe("REFUNDED");

        const order = await Order.findById(s.orderId);
        expect(order.status).toBe("CANCELLED");
        expect(order.cancellationReason).toBe("Le client a changé d'avis");
        expect(await qty(s)).toBe(10);

        const payment = await Payment.findById(s.paymentId);
        expect(payment.status).toBe("REFUNDED");
        expect(payment.refundedAt).toBeTruthy();
        expect(payment.refundTransactionId).toMatch(/^MOCKREF-/);
    });

    it("on ne peut annuler qu'une fois ; motif obligatoire, champ inconnu refusé", async () => {
        const s = await setup();
        expect((await cancel(s.manager.agent, s.orderId, "ok")).status).toBe(400);
        expect((await s.manager.agent.post(`/api/orders/${s.orderId}/cancel-paid`).send({ reason: "Motif valable", role: "admin" })).status).toBe(400);
        expect((await cancel(s.manager.agent, s.orderId)).status).toBe(200);
        const again = await cancel(s.manager.agent, s.orderId);
        expect(again.status).toBe(409);
        expect(again.body.code).toBe("ORDER_NOT_CANCELLABLE");
        expect(await qty(s)).toBe(10);
    });

    it("une commande terminée ne s'annule plus, son paiement reste réglé", async () => {
        const s = await setup();
        for (const step of ["PREPARING", "READY", "COMPLETED"]) expect((await s.setStatus(step)).status).toBe(200);
        const res = await cancel(s.manager.agent, s.orderId);
        expect(res.status).toBe(409);
        expect((await Payment.findById(s.paymentId)).status).toBe("PAID");
        expect(await qty(s)).toBe(8);
    });

    it("l'annulation d'une livraison prête ferme sa course", async () => {
        const s = await setup("DELIVERY");
        await s.setStatus("PREPARING");
        await s.setStatus("READY");
        expect((await Shipment.findOne({ order: s.orderId })).isOpen).toBe(true);

        expect((await cancel(s.manager.agent, s.orderId)).status).toBe(200);
        const shipment = await Shipment.findOne({ order: s.orderId });
        expect(shipment.isOpen).toBe(false);
        expect(shipment.status).toBe("FAILED");
    });

    it("réservé au responsable de la pharmacie concernée ou à l'admin", async () => {
        const s = await setup();
        const pharmacist = await loginAs(app, request, "pharmacist", [s.pharmacy._id]);
        const other = await seedStock(0);
        const stranger = await loginAs(app, request, "pharmacy_manager", [other.pharmacy._id]);

        expect((await cancel(s.patient.agent, s.orderId)).status).toBe(403);
        expect((await cancel(pharmacist.agent, s.orderId)).status).toBe(403);
        expect((await cancel(stranger.agent, s.orderId)).status).toBe(404);
        expect((await Order.findById(s.orderId)).status).toBe("CONFIRMED");

        expect((await cancel(s.admin.agent, s.orderId)).status).toBe(200);
    });
});

describe("Paiements à traiter (administration)", () => {
    // Un paiement arrivé alors que la commande n'était plus payable.
    async function lateAmount() {
        const s = await setup("PICKUP", { settle: false });
        await Order.updateOne({ _id: s.orderId }, { status: "EXPIRED" });
        await s.admin.agent.post(`/api/payments/${s.paymentId}/simulate`).send({ outcome: "PAID" });
        return s;
    }
    const refund = (agent, id, reason = "Commande expirée avant le paiement") =>
        agent.post(`/api/admin/payments/${id}/refund`).send({ reason });

    it("l'admin voit le paiement à traiter et le rembourse ; un second appel ne rembourse pas deux fois", async () => {
        const s = await lateAmount();
        const list = await s.admin.agent.get("/api/admin/payments");
        expect(list.status).toBe(200);
        expect(list.body).toHaveLength(1);
        expect(list.body[0]).toMatchObject({ id: s.paymentId, orderStatus: "EXPIRED", needsReview: true, status: "PAID" });

        const done = await refund(s.admin.agent, s.paymentId);
        expect(done.status).toBe(200);
        expect(done.body.payment.status).toBe("REFUNDED");
        const stored = await Payment.findById(s.paymentId);
        expect(stored.needsReview).toBe(false);
        const firstRef = stored.refundTransactionId;

        const replay = await refund(s.admin.agent, s.paymentId);
        expect(replay.status).toBe(200);
        expect(replay.body.replayed).toBe(true);
        expect((await Payment.findById(s.paymentId)).refundTransactionId).toBe(firstRef);
        expect((await s.admin.agent.get("/api/admin/payments")).body).toHaveLength(0);
    });

    it("deux remboursements simultanés : un seul passe auprès du prestataire", async () => {
        const s = await lateAmount();
        const results = await Promise.all([refund(s.admin.agent, s.paymentId), refund(s.admin.agent, s.paymentId)]);
        expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
        expect(results.some((r) => r.status === 200)).toBe(true);
        expect((await Payment.findById(s.paymentId)).status).toBe("REFUNDED");
    });

    it("pas de remboursement tant que la commande est active, ni pour un paiement non réglé", async () => {
        const active = await setup();
        const blocked = await refund(active.admin.agent, active.paymentId);
        expect(blocked.status).toBe(409);
        expect(blocked.body.code).toBe("ORDER_STILL_ACTIVE");
        expect((await Payment.findById(active.paymentId)).status).toBe("PAID");

        const unpaid = await setup("PICKUP", { settle: false });
        const res = await refund(unpaid.admin.agent, unpaid.paymentId);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("PAYMENT_NOT_REFUNDABLE");
    });

    it("réservé à l'administrateur ; motif obligatoire", async () => {
        const s = await lateAmount();
        expect((await s.manager.agent.get("/api/admin/payments")).status).toBe(403);
        expect((await refund(s.manager.agent, s.paymentId)).status).toBe(403);
        expect((await refund(s.patient.agent, s.paymentId)).status).toBe(403);
        expect((await refund(s.admin.agent, s.paymentId, "x")).status).toBe(400);
        expect((await Payment.findById(s.paymentId)).status).toBe("PAID");
    });
});
