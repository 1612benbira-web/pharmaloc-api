import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, loginAs, Stock, Order } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

async function orderWithPayment({ pay = true } = {}) {
    const s = await seedStock(10);
    await Stock.updateOne({ _id: s.stock._id }, { price: 1000 });
    const patient = await loginAs(app, request, "patient");
    const created = await patient.agent.post("/api/orders").send({
        pharmacy: String(s.pharmacy._id), fulfillment: "PICKUP",
        items: [{ medicine: String(s.medicine._id), quantity: 1 }]
    });
    const orderId = created.body.order._id;
    if (pay) await patient.agent.post("/api/payments").send({ orderId, method: "WAVE" });
    return { patient, orderId };
}
const simulate = (agent, orderId, outcome = "PAID") => agent.post(`/api/payments/order/${orderId}/simulate`).send({ outcome });

describe("Simulateur de paiement du patient (développement)", () => {
  it("le patient conclut le paiement de sa commande : elle passe à CONFIRMED", async () => {
    const { patient, orderId } = await orderWithPayment();
    const res = await simulate(patient.agent, orderId);
    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe("PAID");
    expect((await Order.findById(orderId)).status).toBe("CONFIRMED");
  });

  it("un paiement refusé laisse la commande payable", async () => {
    const { patient, orderId } = await orderWithPayment();
    expect((await simulate(patient.agent, orderId, "FAILED")).body.payment.status).toBe("FAILED");
    expect((await Order.findById(orderId)).status).toBe("PAYMENT_PENDING");
  });

  it("sans paiement lancé, ou pour la commande d'un autre patient : 404, rien n'est modifié", async () => {
    const mine = await orderWithPayment({ pay: false });
    expect((await simulate(mine.patient.agent, mine.orderId)).status).toBe(404);

    const other = await orderWithPayment();
    const intruder = await loginAs(app, request, "patient");
    expect((await simulate(intruder.agent, other.orderId)).status).toBe(404);
    expect((await Order.findById(other.orderId)).status).toBe("PAYMENT_PENDING");
  });

  it("réservé aux patients connectés", async () => {
    const { orderId } = await orderWithPayment();
    expect((await request(app).post(`/api/payments/order/${orderId}/simulate`).send({ outcome: "PAID" })).status).toBe(401);
  });
});
