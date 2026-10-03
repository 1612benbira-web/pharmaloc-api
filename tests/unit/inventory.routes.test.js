import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createRequire } from "module";
import createApp from "../../src/app.js";

const require = createRequire(import.meta.url);
const { setSessionResolver } = require("../../src/middlewares/auth");

const app = createApp();
const P1 = "64b7f0c2a1b2c3d4e5f60718";
const P2 = "64b7f0c2a1b2c3d4e5f60719";
const ID = "64b7f0c2a1b2c3d4e5f6071a";

const fake = async (req) => {
    const h = req.get("x-test-user");
    return h ? { user: JSON.parse(h), session: { _id: "s1" } } : null;
};
beforeAll(() => setSessionResolver(fake));
afterAll(() => setSessionResolver(null));

const as = (role, pharmacies = [P1]) => JSON.stringify({ _id: P1, role, pharmacies });
const manager = as("pharmacy_manager");
const pharmacist = as("pharmacist");

describe("Nouveaux modules : authentification et rôles", () => {
    const endpoints = [
        ["get", "/api/lots"], ["post", `/api/lots/${ID}/quarantine`], ["post", `/api/lots/${ID}/release`],
        ["get", "/api/suppliers"], ["post", "/api/suppliers"], ["patch", `/api/suppliers/${ID}`],
        ["get", "/api/purchase-orders"], ["post", "/api/purchase-orders"], ["post", "/api/purchase-orders/from-suggestions"],
        ["get", `/api/purchase-orders/${ID}`], ["post", `/api/purchase-orders/${ID}/transition`],
        ["get", "/api/replenishment/suggestions"], ["get", "/api/alerts"], ["post", "/api/alerts/evaluate"],
        ["post", `/api/alerts/${ID}/acknowledge`], ["get", `/api/stocks/${ID}/summary`]
    ];

    it.each(endpoints)("%s %s sans session -> 401", async (method, url) => {
        expect((await request(app)[method](url).send({})).status).toBe(401);
    });

    it.each(endpoints)("%s %s refusé à un patient et à un admin de plateforme -> 403", async (method, url) => {
        for (const role of ["patient", "admin"]) {
            const res = await request(app)[method](url).set("x-test-user", as(role, [])).send({});
            expect(res.status, role).toBe(403);
        }
    });

    it("un simple pharmacien ne peut pas libérer un lot, créer/modifier un fournisseur", async () => {
        const body = { reason: "Contrôle qualité conforme" };
        expect((await request(app).post(`/api/lots/${ID}/release`).set("x-test-user", pharmacist).send(body)).status).toBe(403);
        expect((await request(app).post("/api/suppliers").set("x-test-user", pharmacist).send({ pharmacy: P1, name: "Fournisseur" })).status).toBe(403);
        expect((await request(app).patch(`/api/suppliers/${ID}`).set("x-test-user", pharmacist).send({ isActive: false })).status).toBe(403);
    });

    it("correction d'inventaire : réservée au responsable (403 exact pour un pharmacien)", async () => {
        const res = await request(app).post(`/api/stocks/${ID}/movements`).set("x-test-user", pharmacist)
            .send({ type: "ADJUSTMENT", direction: "DOWN", quantity: 3, reason: "Inventaire du 30/09 : écart constaté" });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN_ROLE");
    });

    it("accès à une autre pharmacie refusé (403) pour fournisseur, commande, alertes, lots", async () => {
        const h = manager;
        expect((await request(app).post("/api/suppliers").set("x-test-user", h).send({ pharmacy: P2, name: "Fournisseur" })).status).toBe(403);
        expect((await request(app).post("/api/purchase-orders").set("x-test-user", h)
            .send({ pharmacy: P2, supplier: ID, lines: [{ stock: ID, quantity: 5 }] })).status).toBe(403);
        expect((await request(app).post("/api/purchase-orders/from-suggestions").set("x-test-user", h)
            .send({ pharmacy: P2, supplier: ID, stockIds: [ID] })).status).toBe(403);
        expect((await request(app).post("/api/alerts/evaluate").set("x-test-user", h).send({ pharmacy: P2 })).status).toBe(403);
        expect((await request(app).get(`/api/lots?pharmacy=${P2}`).set("x-test-user", h)).status).toBe(403);
        expect((await request(app).get(`/api/alerts?pharmacy=${P2}`).set("x-test-user", h)).status).toBe(403);
        expect((await request(app).get(`/api/replenishment/suggestions?pharmacy=${P2}`).set("x-test-user", h)).status).toBe(403);
        expect((await request(app).get(`/api/suppliers?pharmacy=${P2}`).set("x-test-user", h)).status).toBe(403);
        expect((await request(app).get(`/api/purchase-orders?pharmacy=${P2}`).set("x-test-user", h)).status).toBe(403);
    });
});

describe("Nouveaux modules : validation des entrées", () => {
    const post = (url, body, h = manager) => request(app).post(url).set("x-test-user", h).send(body);

    it("livraison : lot sans date de péremption (et inversement) refusé, rien n'est deviné", async () => {
        const base = { pharmacy: P1, medicine: ID, quantity: 5 };
        expect((await post("/api/deliveries", { ...base, lotNumber: "L1" }, pharmacist)).status).toBe(400);
        expect((await post("/api/deliveries", { ...base, expiryDate: "2027-01-01" }, pharmacist)).status).toBe(400);
        expect((await post("/api/deliveries", { ...base, lotNumber: "L1", expiryDate: "pas-une-date" }, pharmacist)).status).toBe(400);
    });

    it("mouvement : l'entrée directe (IN), la péremption et la quarantaine ne passent pas par cette route", async () => {
        for (const type of ["IN", "EXPIRY", "QUARANTINE", "RELEASE"]) {
            expect((await post(`/api/stocks/${ID}/movements`, { type, quantity: 1 }, pharmacist)).status, type).toBe(400);
        }
    });

    it("mouvement : ajustement sans direction ni justification, perte sans justification refusés", async () => {
        const url = `/api/stocks/${ID}/movements`;
        const adj = await post(url, { type: "ADJUSTMENT", quantity: 3 }, manager);
        expect(adj.status).toBe(400);
        expect(adj.body.details.map((d) => d.field)).toEqual(expect.arrayContaining(["direction", "reason"]));
        expect((await post(url, { type: "ADJUSTMENT", direction: "UP", quantity: 3, reason: "court" }, manager)).status).toBe(400);
        expect((await post(url, { type: "LOSS", quantity: 2 }, pharmacist)).status).toBe(400);
        expect((await post(url, { type: "OUT", quantity: 2, direction: "UP" }, pharmacist)).status).toBe(400);
    });

    it("quarantaine : motif obligatoire", async () => {
        expect((await post(`/api/lots/${ID}/quarantine`, {}, pharmacist)).status).toBe(400);
        expect((await post(`/api/lots/${ID}/quarantine`, { reason: "x" }, pharmacist)).status).toBe(400);
    });

    it("commande : lignes vides, quantités invalides, transition inconnue refusées", async () => {
        const base = { pharmacy: P1, supplier: ID };
        expect((await post("/api/purchase-orders", { ...base, lines: [] })).status).toBe(400);
        expect((await post("/api/purchase-orders", { ...base, lines: [{ stock: ID, quantity: 0 }] })).status).toBe(400);
        expect((await post("/api/purchase-orders", { ...base, lines: [{ stock: ID, quantity: 2.5 }] })).status).toBe(400);
        expect((await post(`/api/purchase-orders/${ID}/transition`, { to: "RECEIVED" })).status).toBe(400); // réservé aux réceptions
        expect((await post(`/api/purchase-orders/${ID}/transition`, { to: "N_IMPORTE_QUOI" })).status).toBe(400);
    });

    it("réglages de réapprovisionnement : valeurs négatives ou décimales refusées ; quantité toujours interdite", async () => {
        const patch = (b) => request(app).patch(`/api/stocks/${ID}`).set("x-test-user", manager).send(b);
        expect((await patch({ targetQuantity: -1 })).status).toBe(400);
        expect((await patch({ packSize: 0 })).status).toBe(400);
        expect((await patch({ leadTimeDays: 1.5 })).status).toBe(400);
        expect((await patch({})).status).toBe(400);
        expect((await patch({ targetQuantity: 100, quantity: 5 })).status).toBe(400);
    });

    it("paramètres de requête invalides refusés", async () => {
        const get = (u) => request(app).get(u).set("x-test-user", manager);
        expect((await get("/api/replenishment/suggestions?safetyFactor=5")).status).toBe(400);
        expect((await get("/api/lots?state=PERIME")).status).toBe(400);
        expect((await get("/api/alerts?limit=9999")).status).toBe(400);
        expect((await get("/api/purchase-orders?pharmacy=abc")).status).toBe(400);
    });
});
