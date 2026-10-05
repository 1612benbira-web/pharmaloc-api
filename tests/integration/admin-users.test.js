import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, loginAs, PASSWORD } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

async function team() {
    const s = await seedStock(0);
    const admin = await loginAs(app, request, "admin", []);
    const manager = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
    const courier = await loginAs(app, request, "courier", [s.pharmacy._id]);
    const patient = await loginAs(app, request, "patient");
    return { s, admin, manager, courier, patient };
}
const status = (admin, id, isActive) => admin.agent.patch(`/api/admin/users/${id}/status`).send({ isActive });

describe("Liste des comptes (administration)", () => {
    it("l'admin voit le personnel et les livreurs avec leurs pharmacies, jamais les patients ni les hash", async () => {
        const { admin, manager, courier, patient } = await team();
        const res = await admin.agent.get("/api/admin/users");
        expect(res.status).toBe(200);
        const emails = res.body.map((u) => u.email);
        expect(emails).toEqual(expect.arrayContaining([admin.email, manager.email, courier.email]));
        expect(emails).not.toContain(patient.email);
        expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);
        expect(res.body.find((u) => u.email === manager.email).pharmacies[0].name).toBe("Pharmacie TEST");
        expect(res.headers["x-total-count"]).toBe("3");
    });

    it("filtre par rôle et par recherche", async () => {
        const { admin, courier } = await team();
        const byRole = await admin.agent.get("/api/admin/users?role=courier");
        expect(byRole.body.map((u) => u.email)).toEqual([courier.email]);
        const byText = await admin.agent.get("/api/admin/users?q=courier");
        expect(byText.body.map((u) => u.email)).toEqual([courier.email]);
        expect((await admin.agent.get("/api/admin/users?role=patient")).status).toBe(400);
    });

    it("réservé à l'administrateur connecté", async () => {
        const { manager, patient } = await team();
        expect((await manager.agent.get("/api/admin/users")).status).toBe(403);
        expect((await patient.agent.get("/api/admin/users")).status).toBe(403);
        expect((await request(app).get("/api/admin/users")).status).toBe(401);
    });
});

describe("Suspension et réactivation", () => {
    it("un compte suspendu perd sa session et ne peut plus se connecter ; il revient à la réactivation", async () => {
        const { admin, courier } = await team();
        expect((await courier.agent.get("/api/auth/me")).status).toBe(200);

        const off = await status(admin, courier.user._id, false);
        expect(off.status).toBe(200);
        expect(off.body.user.isActive).toBe(false);
        expect((await courier.agent.get("/api/auth/me")).status).toBe(401);
        expect((await request(app).post("/api/auth/login").send({ email: courier.email, password: PASSWORD })).status).toBe(401);

        expect((await status(admin, courier.user._id, true)).status).toBe(200);
        expect((await request(app).post("/api/auth/login").send({ email: courier.email, password: PASSWORD })).status).toBe(200);
    });

    it("un admin ne peut pas désactiver son propre compte", async () => {
        const { admin } = await team();
        const res = await status(admin, admin.user._id, false);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("CANNOT_DEACTIVATE_SELF");
        expect((await admin.agent.get("/api/auth/me")).status).toBe(200);
    });

    it("un patient ou un identifiant inconnu : 404 ; corps invalide : 400 ; non-admin : 403", async () => {
        const { admin, manager, patient, courier } = await team();
        expect((await status(admin, patient.user._id, false)).status).toBe(404);
        expect((await status(admin, "64b7f0c2a1b2c3d4e5f60718", false)).status).toBe(404);
        const bad = (body) => admin.agent.patch(`/api/admin/users/${courier.user._id}/status`).send(body);
        expect((await bad({ isActive: "non" })).status).toBe(400);
        expect((await bad({ isActive: false, role: "admin" })).status).toBe(400);
        expect((await status(manager, courier.user._id, false)).status).toBe(403);
    });
});
