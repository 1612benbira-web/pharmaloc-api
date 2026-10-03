import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, loginAs, Stock, Order } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

async function shop(quantity = 50) {
    const s = await seedStock(quantity);
    await Stock.updateOne({ _id: s.stock._id }, { price: 1000 });
    const patient = await loginAs(app, request, "patient");
    return { ...s, patient };
}

const orderBody = (s) => ({
    pharmacy: String(s.pharmacy._id), fulfillment: "PICKUP",
    items: [{ medicine: String(s.medicine._id), quantity: 1 }]
});
const place = (s, key) => {
    const r = s.patient.agent.post("/api/orders");
    if (key) r.set("Idempotency-Key", key);
    return r.send(orderBody(s));
};

describe("Limite de commandes en attente de paiement", () => {
    async function fillUp(s, count = 5) {
        const ids = [];
        for (let i = 0; i < count; i++) {
            const res = await place(s);
            expect(res.status).toBe(201);
            ids.push(res.body.order._id);
        }
        return ids;
    }

    it("la 6e commande non payée est refusée, sans réserver de stock", async () => {
        const s = await shop();
        await fillUp(s);
        const blocked = await place(s);
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe("TOO_MANY_OPEN_ORDERS");
        expect((await Stock.findById(s.stock._id)).quantity).toBe(45);
    });

    it("annuler une commande libère une place", async () => {
        const s = await shop();
        const ids = await fillUp(s);
        expect((await s.patient.agent.post(`/api/orders/${ids[0]}/cancel`)).status).toBe(200);
        expect((await place(s)).status).toBe(201);
    });

    it("une commande dont le délai est dépassé ne compte plus", async () => {
        const s = await shop();
        const ids = await fillUp(s);
        await Order.updateOne({ _id: ids[0] }, { reservationExpiresAt: new Date(Date.now() - 1000) });
        expect((await place(s)).status).toBe(201);
        expect((await Order.findById(ids[0])).status).toBe("EXPIRED");
    });

    it("le rejeu d'une commande déjà créée n'est jamais bloqué", async () => {
        const s = await shop();
        await fillUp(s, 4);
        expect((await place(s, "commande-cinquieme")).status).toBe(201);
        expect((await place(s)).status).toBe(429);
        const replay = await place(s, "commande-cinquieme");
        expect(replay.status).toBe(200);
        expect(replay.body.replayed).toBe(true);
    });

    it("la limite est propre à chaque patient", async () => {
        const s = await shop();
        await fillUp(s);
        const other = await loginAs(app, request, "patient");
        const res = await other.agent.post("/api/orders").send(orderBody(s));
        expect(res.status).toBe(201);
    });
});