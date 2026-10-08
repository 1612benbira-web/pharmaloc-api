import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, addStock, loginAs, inDays, Stock, Order } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

// Une pharmacie avec : une vente terminée (2 unités à 1000), une commande annulée, un lot qui expire bientôt,
// un produit en stock faible et un produit en rupture.
async function shopWithSales() {
    const s = await seedStock(10);
    await Stock.updateOne({ _id: s.stock._id }, { price: 1000 });
    const patient = await loginAs(app, request, "patient");
    const manager = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);

    const received = await manager.agent.post("/api/deliveries").send({
        pharmacy: String(s.pharmacy._id), medicine: String(s.medicine._id), quantity: 5,
        lotNumber: "L1", expiryDate: inDays(10).toISOString()
    });
    expect(received.status).toBe(201);
    await Stock.updateOne({ _id: s.stock._id }, { minimumQuantity: 20 }); // 15 en stock, seuil 20 : stock faible
    await addStock(s.pharmacy, 0, "Produit en rupture");

    const body = { pharmacy: String(s.pharmacy._id), fulfillment: "PICKUP", items: [{ medicine: String(s.medicine._id), quantity: 2 }] };
    const sale = await patient.agent.post("/api/orders").send(body);
    const saleId = sale.body.order._id;
    await patient.agent.post("/api/payments").send({ orderId: saleId, method: "WAVE" });
    await patient.agent.post(`/api/payments/order/${saleId}/simulate`).send({ outcome: "PAID" });
    for (const step of ["PREPARING", "READY", "COMPLETED"]) {
        await manager.agent.patch(`/api/orders/${saleId}/status`).send({ status: step });
    }

    const abandoned = await patient.agent.post("/api/orders").send(body);
    await patient.agent.post(`/api/orders/${abandoned.body.order._id}/cancel`);
    return { ...s, patient, manager, saleId };
}
const stats = (agent, query = "") => agent.get(`/api/orders/pharmacy/stats${query}`);

describe("Statistiques de la pharmacie", () => {
    it("ventes, panier moyen, produits les plus vendus, statuts et état du stock", async () => {
        const s = await shopWithSales();
        const res = await stats(s.manager.agent);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ days: 30, orders: 1, revenue: 2000, deliveryFees: 0, averageBasket: 2000 });
        expect(res.body.topProducts).toEqual([
            expect.objectContaining({ name: "Paracétamol TEST", quantity: 2, revenue: 2000 })
        ]);
        expect(res.body.ordersByStatus).toMatchObject({ COMPLETED: 1, CANCELLED: 1 });
        expect(res.body.stock).toEqual({ outOfStock: 1, lowStock: 1, lotsExpiringIn30Days: 1 });
    });

    it("les commandes annulées ne comptent pas dans les ventes, et les anciennes sortent de la période", async () => {
        const s = await shopWithSales();
        await Order.collection.updateOne({ _id: new (await import("mongoose")).default.Types.ObjectId(s.saleId) }, { $set: { createdAt: new Date(Date.now() - 40 * 86400000) } });

        const month = await stats(s.manager.agent);
        expect(month.body.orders).toBe(0);
        expect(month.body.revenue).toBe(0);
        expect(month.body.averageBasket).toBe(0);
        expect(month.body.topProducts).toEqual([]);

        const quarter = await stats(s.manager.agent, "?days=90");
        expect(quarter.body.orders).toBe(1);
    });

    it("une pharmacie sans activité renvoie des zéros", async () => {
        const s = await seedStock(0);
        const manager = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
        const res = await stats(manager.agent);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ orders: 0, revenue: 0, topProducts: [], ordersByStatus: {} });
    });

    it("cloisonnement : ni les ventes ni le stock d'une autre pharmacie ne sont comptés", async () => {
        const s = await shopWithSales();
        const other = await seedStock(0);
        const stranger = await loginAs(app, request, "pharmacy_manager", [other.pharmacy._id]);

        const own = await stats(stranger.agent);
        expect(own.body.orders).toBe(0);
        expect(own.body.stock.lowStock).toBe(0);

        const foreign = await stats(stranger.agent, `?pharmacy=${s.pharmacy._id}`);
        expect(foreign.status).toBe(403);
        expect(foreign.body.code).toBe("FORBIDDEN_PHARMACY");
    });

    it("un pharmacien peut les lire ; patient, admin et visiteur non ; période invalide refusée", async () => {
        const s = await shopWithSales();
        const pharmacist = await loginAs(app, request, "pharmacist", [s.pharmacy._id]);
        const admin = await loginAs(app, request, "admin", []);

        expect((await stats(pharmacist.agent)).status).toBe(200);
        expect((await stats(s.patient.agent)).status).toBe(403);
        expect((await stats(admin.agent)).status).toBe(403);
        expect((await request(app).get("/api/orders/pharmacy/stats")).status).toBe(401);
        expect((await stats(s.manager.agent, "?days=0")).status).toBe(400);
        expect((await stats(s.manager.agent, "?days=999")).status).toBe(400);
    });
});
