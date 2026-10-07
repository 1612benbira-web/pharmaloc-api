import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, loginAs, AuditLog, Stock, Order, PASSWORD } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Le journal s'écrit juste après la réponse : on attend un instant son apparition.
async function logged(filter, tries = 40) {
    for (let i = 0; i < tries; i++) {
        const doc = await AuditLog.findOne(filter);
        if (doc) return doc;
        await sleep(50);
    }
    return null;
}
const count = async (filter) => { await sleep(300); return AuditLog.countDocuments(filter); };

describe("Journal des comptes", () => {
    it("suspension et réactivation : acteur, cible et état journalisés ; une action refusée ne l'est pas", async () => {
        const s = await seedStock(0);
        const admin = await loginAs(app, request, "admin", []);
        const courier = await loginAs(app, request, "courier", [s.pharmacy._id]);

        await admin.agent.patch(`/api/admin/users/${courier.user._id}/status`).send({ isActive: false });
        const off = await logged({ action: "USER_DEACTIVATED" });
        expect(String(off.actor)).toBe(String(admin.user._id));
        expect(off.target).toBe(String(courier.user._id));

        await admin.agent.patch(`/api/admin/users/${courier.user._id}/status`).send({ isActive: true });
        expect(await logged({ action: "USER_ACTIVATED" })).toBeTruthy();

        const self = await admin.agent.patch(`/api/admin/users/${admin.user._id}/status`).send({ isActive: false });
        expect(self.status).toBe(409);
        expect(await count({ action: "USER_DEACTIVATED" })).toBe(1);
    });

    it("changement de mot de passe journalisé, sans aucun mot de passe dans le journal", async () => {
        const patient = await loginAs(app, request, "patient");
        const NEW = "Nouveau-Mot-De-Passe-2026";
        await patient.agent.post("/api/auth/change-password").send({ currentPassword: PASSWORD, newPassword: NEW });
        const entry = await logged({ action: "PASSWORD_CHANGED" });
        expect(String(entry.actor)).toBe(String(patient.user._id));
        const text = JSON.stringify(entry);
        expect(text).not.toContain(PASSWORD);
        expect(text).not.toContain(NEW);
    });
});

describe("Journal du catalogue", () => {
    it("médicaments : création, modification (noms de champs seulement) et suppression", async () => {
        const admin = await loginAs(app, request, "admin", []);
        const created = await admin.agent.post("/api/medicines").send({ name: "Produit audit" });
        const entry = await logged({ action: "MEDICINE_CREATED" });
        expect(entry.target).toBe(String(created.body.medicine._id));
        expect(entry.meta.name).toBe("Produit audit");

        await admin.agent.patch(`/api/medicines/${created.body.medicine._id}`).send({ dosage: "500 mg", isActive: false });
        const edit = await logged({ action: "MEDICINE_UPDATED" });
        expect(edit.meta.fields.sort()).toEqual(["dosage", "isActive"]);
        expect(edit.meta.isActive).toBe(false);
        expect(JSON.stringify(edit)).not.toContain("500 mg");

        await admin.agent.delete(`/api/medicines/${created.body.medicine._id}`);
        expect(await logged({ action: "MEDICINE_DELETED" })).toBeTruthy();
    });

    it("proposition d'un responsable journalisée à son nom ; réglages de pharmacie sans valeurs", async () => {
        const s = await seedStock(0);
        const manager = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
        await manager.agent.post("/api/medicines").send({ name: "Proposition" });
        const proposal = await logged({ action: "MEDICINE_CREATED" });
        expect(String(proposal.actor)).toBe(String(manager.user._id));

        await manager.agent.patch(`/api/pharmacies/${s.pharmacy._id}`).send({ openingHours: "8h-20h" });
        const edit = await logged({ action: "PHARMACY_UPDATED" });
        expect(edit.meta.fields).toEqual(["openingHours"]);
        expect(JSON.stringify(edit)).not.toContain("8h-20h");
    });
});

describe("Journal des annulations et remboursements", () => {
    async function order({ settle = true } = {}) {
        const s = await seedStock(10);
        await Stock.updateOne({ _id: s.stock._id }, { price: 1000 });
        const patient = await loginAs(app, request, "patient");
        const manager = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
        const admin = await loginAs(app, request, "admin", []);
        const created = await patient.agent.post("/api/orders").send({
            pharmacy: String(s.pharmacy._id), fulfillment: "PICKUP", items: [{ medicine: String(s.medicine._id), quantity: 1 }]
        });
        const orderId = created.body.order._id;
        const pay = await patient.agent.post("/api/payments").send({ orderId, method: "WAVE" });
        const paymentId = pay.body.payment._id;
        if (settle) await admin.agent.post(`/api/payments/${paymentId}/simulate`).send({ outcome: "PAID" });
        return { manager, admin, orderId, paymentId };
    }

    it("annulation d'une commande payée : motif et issue du remboursement journalisés", async () => {
        const o = await order();
        await o.manager.agent.post(`/api/orders/${o.orderId}/cancel-paid`).send({ reason: "Produit abîmé en préparation" });
        const entry = await logged({ action: "ORDER_CANCELLED_PAID" });
        expect(String(entry.actor)).toBe(String(o.manager.user._id));
        expect(entry.target).toBe(o.orderId);
        expect(entry.meta).toMatchObject({ reason: "Produit abîmé en préparation", refund: "REFUNDED" });
    });

    it("remboursement par l'admin journalisé une seule fois, même rejoué", async () => {
        const o = await order({ settle: false });
        await Order.updateOne({ _id: o.orderId }, { status: "EXPIRED" });
        await o.admin.agent.post(`/api/payments/${o.paymentId}/simulate`).send({ outcome: "PAID" });
        const refund = () => o.admin.agent.post(`/api/admin/payments/${o.paymentId}/refund`).send({ reason: "Commande expirée avant le paiement" });
        expect((await refund()).status).toBe(200);
        expect((await refund()).body.replayed).toBe(true);
        expect(await logged({ action: "PAYMENT_REFUNDED" })).toBeTruthy();
        expect(await count({ action: "PAYMENT_REFUNDED" })).toBe(1);
    });
});

describe("Consultation du journal", () => {
    it("l'admin lit le journal avec le nom de l'acteur, filtre par action ; les autres rôles sont refusés", async () => {
        const s = await seedStock(0);
        const admin = await loginAs(app, request, "admin", []);
        const manager = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
        await admin.agent.post("/api/medicines").send({ name: "Produit journal" });
        await logged({ action: "MEDICINE_CREATED" });

        const all = await admin.agent.get("/api/admin/audit");
        expect(all.status).toBe(200);
        expect(all.body[0].actor.name).toBe("Utilisateur Test");
        expect(all.headers["x-total-count"]).toBeDefined();

        const filtered = await admin.agent.get("/api/admin/audit?action=MEDICINE_CREATED");
        expect(filtered.body.every((e) => e.action === "MEDICINE_CREATED")).toBe(true);
        expect((await admin.agent.get("/api/admin/audit?action=INCONNUE")).body).toEqual([]);

        expect((await manager.agent.get("/api/admin/audit")).status).toBe(403);
        expect((await request(app).get("/api/admin/audit")).status).toBe(401);
    });
});
