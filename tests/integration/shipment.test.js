import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, loginAs, Stock, Order, Shipment, PASSWORD } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

// Commande payée + patient, responsable, livreur de la même pharmacie, admin.
async function paidOrder(fulfillment = "DELIVERY") {
    const s = await seedStock(10);
    await Stock.updateOne({ _id: s.stock._id }, { price: 1000 });
    const patient = await loginAs(app, request, "patient");
    const staff = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
    const courier = await loginAs(app, request, "courier", [s.pharmacy._id]);
    const admin = await loginAs(app, request, "admin", []);

    const created = await patient.agent.post("/api/orders").send({
        pharmacy: String(s.pharmacy._id), fulfillment,
        items: [{ medicine: String(s.medicine._id), quantity: 2 }],
        ...(fulfillment === "DELIVERY" ? { deliveryAddress: "Pikine, Dakar", contactPhone: "770000011" } : {})
    });
    const orderId = created.body.order._id;
    const pay = await patient.agent.post("/api/payments").send({ orderId, method: "WAVE" });
    await admin.agent.post(`/api/payments/${pay.body.payment._id}/simulate`).send({ outcome: "PAID" });

    const setStatus = (to) => staff.agent.patch(`/api/orders/${orderId}/status`).send({ status: to });
    return { ...s, patient, staff, courier, admin, orderId, setStatus };
}

async function readyOrder(fulfillment) {
    const r = await paidOrder(fulfillment);
    await r.setStatus("PREPARING");
    await r.setStatus("READY");
    return r;
}

const openShipment = (r) => Shipment.findOne({ order: r.orderId, isOpen: true });
const shipmentId = async (r) => String((await openShipment(r))._id);
const orderStatus = async (r) => (await Order.findById(r.orderId)).status;
const act = async (r, action, body = {}, agent = r.courier.agent) =>
    agent.post(`/api/shipments/${await shipmentId(r)}/${action}`).send(body);
const codeFor = async (r) => (await r.patient.agent.get(`/api/shipments/order/${r.orderId}`)).body.deliveryCode;
const wrongCode = (code) => (code === "000000" ? "111111" : "000000");

describe("Création de la course", () => {
    it("aucune course avant que la commande soit prête ; une course PENDING ensuite", async () => {
        const r = await paidOrder();
        await r.setStatus("PREPARING");
        expect(await Shipment.countDocuments()).toBe(0);

        await r.setStatus("READY");
        const shipment = await openShipment(r);
        expect(shipment.status).toBe("PENDING");
        expect(shipment.address).toBe("Pikine, Dakar");
        expect(shipment.contactPhone).toBe("770000011");
        expect(shipment.items.map((i) => i.quantity)).toEqual([2]);
    });

    it("une commande en retrait ne crée jamais de course", async () => {
        const r = await readyOrder("PICKUP");
        expect(await Shipment.countDocuments()).toBe(0);
    });
});

describe("Prise en charge", () => {
    it("le livreur voit les courses de sa pharmacie, sans le téléphone du client ni le code", async () => {
        const r = await readyOrder();
        const res = await r.courier.agent.get("/api/shipments/available");
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].address).toBe("Pikine, Dakar");
        const text = JSON.stringify(res.body);
        expect(text).not.toContain("contactPhone");
        expect(text).not.toContain("deliveryCode");
        expect(text).not.toContain("770000011");
    });

    it("un livreur d'une autre pharmacie ne voit ni ne peut prendre la course", async () => {
        const r = await readyOrder();
        const other = await seedStock(0);
        const stranger = await loginAs(app, request, "courier", [other.pharmacy._id]);
        expect((await stranger.agent.get("/api/shipments/available")).body).toHaveLength(0);
        expect((await act(r, "claim", {}, stranger.agent)).status).toBe(404);
        expect((await openShipment(r)).status).toBe("PENDING");
    });

    it("prise en charge : le livreur reçoit téléphone et contenu, jamais le code ni le prix", async () => {
        const r = await readyOrder();
        const res = await act(r, "claim");
        expect(res.status).toBe(200);
        expect(res.body.shipment.status).toBe("ASSIGNED");
        expect(res.body.shipment.contactPhone).toBe("770000011");
        expect(res.body.shipment.items).toEqual([{ name: "Paracétamol TEST", quantity: 2 }]);
        const text = JSON.stringify(res.body);
        expect(text).not.toContain("deliveryCode");
        expect(text).not.toContain("unitPrice");
    });

    it("5 livreurs prennent la même course en même temps : un seul gagne", async () => {
        const r = await readyOrder();
        const others = await Promise.all(Array.from({ length: 4 }, () => loginAs(app, request, "courier", [r.pharmacy._id])));
        const id = await shipmentId(r);
        const results = await Promise.all([r.courier, ...others].map((c) => c.agent.post(`/api/shipments/${id}/claim`)));
        expect(results.filter((x) => x.status === 200)).toHaveLength(1);
        expect(results.filter((x) => x.status === 409)).toHaveLength(4);
    });

    it("le livreur peut rendre sa course ; un autre la prend ; on ne rend pas la course d'un autre", async () => {
        const r = await readyOrder();
        const other = await loginAs(app, request, "courier", [r.pharmacy._id]);
        await act(r, "claim");
        expect((await act(r, "release", {}, other.agent)).status).toBe(404);

        expect((await act(r, "release")).status).toBe(200);
        const shipment = await openShipment(r);
        expect(shipment.status).toBe("PENDING");
        expect(shipment.courier).toBeUndefined();
        expect((await act(r, "claim", {}, other.agent)).status).toBe(200);
    });
});

describe("Remise et code", () => {
    async function pickedUp() {
        const r = await readyOrder();
        await act(r, "claim");
        expect((await act(r, "pickup")).status).toBe(200);
        return r;
    }

    it("pickup : la commande passe à OUT_FOR_DELIVERY ; impossible sans avoir pris la course", async () => {
        const r = await readyOrder();
        expect((await act(r, "pickup")).status).toBe(404);
        await act(r, "claim");
        expect((await act(r, "pickup")).status).toBe(200);
        expect(await orderStatus(r)).toBe("OUT_FOR_DELIVERY");
    });

    it("livraison avec le bon code : course DELIVERED, commande COMPLETED, code retiré du suivi patient", async () => {
        const r = await pickedUp();
        const code = await codeFor(r);
        const res = await act(r, "deliver", { code });
        expect(res.status).toBe(200);
        expect(res.body.shipment.status).toBe("DELIVERED");
        expect(await orderStatus(r)).toBe("COMPLETED");

        const view = await r.patient.agent.get(`/api/shipments/order/${r.orderId}`);
        expect(view.body.status).toBe("DELIVERED");
        expect(view.body.deliveryCode).toBeUndefined();
    });

    it("mauvais code : refusé, commande inchangée, essais décomptés", async () => {
        const r = await pickedUp();
        const code = await codeFor(r);
        const res = await act(r, "deliver", { code: wrongCode(code) });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("INVALID_DELIVERY_CODE");
        expect(res.body.details.attemptsLeft).toBe(4);
        expect(await orderStatus(r)).toBe("OUT_FOR_DELIVERY");
    });

    it("format de code invalide : refusé", async () => {
        const r = await pickedUp();
        expect((await act(r, "deliver", { code: "12" })).status).toBe(400);
        expect((await act(r, "deliver", {})).status).toBe(400);
    });

    it("5 codes faux : la saisie est bloquée, même avec le bon code ensuite", async () => {
        const r = await pickedUp();
        const code = await codeFor(r);
        for (let i = 0; i < 5; i++) await act(r, "deliver", { code: wrongCode(code) });
        const locked = await act(r, "deliver", { code });
        expect(locked.status).toBe(429);
        expect(locked.body.code).toBe("TOO_MANY_CODE_ATTEMPTS");
        expect(await orderStatus(r)).toBe("OUT_FOR_DELIVERY");
    });

    it("on ne peut pas livrer une course qu'on n'a pas encore récupérée", async () => {
        const r = await readyOrder();
        await act(r, "claim");
        const code = await codeFor(r);
        expect((await act(r, "deliver", { code })).status).toBe(409);
        expect(await orderStatus(r)).toBe("READY");
    });

    it("le personnel ne peut pas clore la livraison à la place du livreur", async () => {
        const r = await pickedUp();
        const res = await r.setStatus("COMPLETED");
        expect(res.status).toBe(409);
        expect(await orderStatus(r)).toBe("OUT_FOR_DELIVERY");
    });
});

describe("Échec de livraison", () => {
    it("la commande redevient prête et une nouvelle course est proposée, jusqu'à 3 tentatives", async () => {
        const r = await readyOrder();
        for (let attempt = 1; attempt <= 3; attempt++) {
            expect((await openShipment(r)).attempt).toBe(attempt);
            expect((await act(r, "claim")).status).toBe(200);
            expect((await act(r, "pickup")).status).toBe(200);
            const res = await act(r, "fail", { reason: "Client injoignable" });
            expect(res.status).toBe(200);
            expect(res.body.redispatched).toBe(attempt < 3);
            expect(await orderStatus(r)).toBe("READY");
        }
        expect(await Shipment.countDocuments({ order: r.orderId })).toBe(3);
        expect(await openShipment(r)).toBeNull();
    });

    it("après un blocage du code, le livreur peut signaler l'échec", async () => {
        const r = await readyOrder();
        await act(r, "claim");
        await act(r, "pickup");
        const code = await codeFor(r);
        for (let i = 0; i < 5; i++) await act(r, "deliver", { code: wrongCode(code) });
        const res = await act(r, "fail", { reason: "Code refusé, client absent" });
        expect(res.status).toBe(200);
        expect(res.body.shipment.status).toBe("FAILED");
    });

    it("motif obligatoire", async () => {
        const r = await readyOrder();
        await act(r, "claim");
        await act(r, "pickup");
        expect((await act(r, "fail", { reason: "" })).status).toBe(400);
    });
});

describe("Suivi et cloisonnement", () => {
    it("le patient voit son code et le prénom du livreur ; le code n'apparaît nulle part ailleurs", async () => {
        const r = await readyOrder();
        await act(r, "claim");

        const view = await r.patient.agent.get(`/api/shipments/order/${r.orderId}`);
        expect(view.status).toBe(200);
        expect(view.body.deliveryCode).toMatch(/^\d{6}$/);
        expect(view.body.status).toBe("ASSIGNED");
        expect(view.body.courier.name).toBe("Utilisateur Test");

        const everywhere = [
            await r.courier.agent.get("/api/shipments/mine"),
            await r.staff.agent.get("/api/shipments/pharmacy"),
            await r.staff.agent.get(`/api/orders/${r.orderId}`)
        ];
        for (const res of everywhere) {
            expect(res.status).toBe(200);
            expect(JSON.stringify(res.body)).not.toContain("deliveryCode");
        }
    });

    it("un autre patient ne voit pas la livraison ; le livreur n'a pas accès à cette route", async () => {
        const r = await readyOrder();
        const other = await loginAs(app, request, "patient");
        expect((await other.agent.get(`/api/shipments/order/${r.orderId}`)).status).toBe(404);
        expect((await r.courier.agent.get(`/api/shipments/order/${r.orderId}`)).status).toBe(403);
    });

    it("le personnel suit les courses de sa pharmacie seulement", async () => {
        const r = await readyOrder();
        await act(r, "claim");
        const list = await r.staff.agent.get("/api/shipments/pharmacy");
        expect(list.body).toHaveLength(1);
        expect(list.body[0].status).toBe("ASSIGNED");
        expect(list.body[0].courier.name).toBe("Utilisateur Test");
        expect((await r.staff.agent.get("/api/shipments/pharmacy?status=PENDING")).body).toHaveLength(0);

        const other = await seedStock(0);
        const stranger = await loginAs(app, request, "pharmacy_manager", [other.pharmacy._id]);
        expect((await stranger.agent.get("/api/shipments/pharmacy")).body).toHaveLength(0);
        expect((await r.courier.agent.get("/api/shipments/pharmacy")).status).toBe(403);
    });

    it("un livreur ne voit que ses propres courses", async () => {
        const r = await readyOrder();
        const other = await loginAs(app, request, "courier", [r.pharmacy._id]);
        await act(r, "claim");
        expect((await r.courier.agent.get("/api/shipments/mine")).body).toHaveLength(1);
        expect((await other.agent.get("/api/shipments/mine")).body).toHaveLength(0);
    });
});

describe("Rôle livreur", () => {
    it("un livreur n'a accès ni aux stocks ni à la commande ; patient et personnel ne prennent pas de course", async () => {
        const r = await readyOrder();
        expect((await r.courier.agent.get("/api/stocks")).status).toBe(403);
        expect((await r.courier.agent.get(`/api/orders/${r.orderId}`)).status).toBe(404);
        expect((await r.courier.agent.post("/api/orders").send({})).status).toBe(403);
        expect((await act(r, "claim", {}, r.patient.agent)).status).toBe(403);
        expect((await act(r, "claim", {}, r.staff.agent)).status).toBe(403);
    });

    it("un admin crée un livreur affecté à une pharmacie ; sans pharmacie : refusé", async () => {
        const admin = await loginAs(app, request, "admin", []);
        const s = await seedStock(0);
        const body = { name: "Moussa Livreur", email: "livreur@exemple.sn", password: PASSWORD, role: "courier" };

        expect((await admin.agent.post("/api/admin/users").send({ ...body, pharmacies: [] })).status).toBe(400);
        const ok = await admin.agent.post("/api/admin/users").send({ ...body, pharmacies: [String(s.pharmacy._id)] });
        expect(ok.status).toBe(201);
        expect(ok.body.user.role).toBe("courier");
    });
});