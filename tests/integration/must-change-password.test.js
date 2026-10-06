import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, loginAs, PASSWORD } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

const NEW_PASSWORD = "Nouveau-Mot-De-Passe-2026";

// Un admin crée un livreur avec un mot de passe provisoire, qui se connecte ensuite.
async function provisionalCourier() {
    const s = await seedStock(0);
    const admin = await loginAs(app, request, "admin", []);
    const email = "livreur@exemple.sn";
    const created = await admin.agent.post("/api/admin/users").send({
        name: "Moussa Livreur", email, password: PASSWORD, role: "courier", pharmacies: [String(s.pharmacy._id)]
    });
    expect(created.status).toBe(201);
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    return { agent, login };
}

describe("Mot de passe provisoire", () => {
    it("un compte créé par l'admin doit changer son mot de passe avant tout autre usage", async () => {
        const { agent, login } = await provisionalCourier();
        expect(login.body.user.mustChangePassword).toBe(true);

        const me = await agent.get("/api/auth/me");
        expect(me.status).toBe(200);
        expect(me.body.user.mustChangePassword).toBe(true);

        const blocked = await agent.get("/api/shipments/available");
        expect(blocked.status).toBe(403);
        expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");

        const changed = await agent.post("/api/auth/change-password").send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
        expect(changed.status).toBe(200);

        expect((await agent.get("/api/shipments/available")).status).toBe(200);
        expect((await agent.get("/api/auth/me")).body.user.mustChangePassword).toBe(false);
    });

    it("tant que le mot de passe est provisoire, on peut au moins se déconnecter", async () => {
        const { agent } = await provisionalCourier();
        expect((await agent.post("/api/auth/logout")).status).toBe(200);
        expect((await agent.get("/api/auth/me")).status).toBe(401);
    });

    it("un compte créé autrement (inscription patient, comptes de test) n'est jamais bloqué", async () => {
        const { agent } = await loginAs(app, request, "patient");
        const me = await agent.get("/api/auth/me");
        expect(me.body.user.mustChangePassword).toBe(false);
        expect((await agent.get("/api/orders/mine")).status).toBe(200);
    });
});
