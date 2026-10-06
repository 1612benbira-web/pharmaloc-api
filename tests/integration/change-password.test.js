import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, loginAs, User, PASSWORD } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

const NEW_PASSWORD = "Nouveau-Mot-De-Passe-2026";
const change = (agent, body) => agent.post("/api/auth/change-password").send(body);
const login = (email, password) => request(app).post("/api/auth/login").send({ email, password });

describe("Changement de mot de passe", () => {
    it("le nouveau mot de passe fonctionne, l'ancien non, et rien n'est stocké en clair", async () => {
        const { agent, email, user } = await loginAs(app, request, "patient");
        const res = await change(agent, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
        expect(res.status).toBe(200);

        expect((await login(email, PASSWORD)).status).toBe(401);
        expect((await login(email, NEW_PASSWORD)).status).toBe(200);

        const stored = await User.findById(user._id).select("+passwordHash");
        expect(stored.passwordHash.startsWith("scrypt$")).toBe(true);
        expect(stored.passwordHash).not.toContain(NEW_PASSWORD);
    });

    it("les autres appareils sont déconnectés, l'appareil actuel reste connecté", async () => {
        const { agent, email } = await loginAs(app, request, "pharmacy_manager", []);
        const other = request.agent(app);
        await other.post("/api/auth/login").send({ email, password: PASSWORD });
        expect((await other.get("/api/auth/me")).status).toBe(200);

        expect((await change(agent, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(200);
        expect((await agent.get("/api/auth/me")).status).toBe(200);
        expect((await other.get("/api/auth/me")).status).toBe(401);
    });

    it("mauvais mot de passe actuel : refusé, rien ne change", async () => {
        const { agent, email } = await loginAs(app, request, "patient");
        const res = await change(agent, { currentPassword: "mauvais-mot-de-passe", newPassword: NEW_PASSWORD });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("INVALID_CURRENT_PASSWORD");
        expect((await login(email, PASSWORD)).status).toBe(200);
    });

    it("5 mauvais essais verrouillent le compte, même avec le bon mot de passe ensuite", async () => {
        const { agent } = await loginAs(app, request, "patient");
        for (let i = 0; i < 5; i++) await change(agent, { currentPassword: "mauvais-mot-de-passe", newPassword: NEW_PASSWORD });
        const res = await change(agent, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe("ACCOUNT_LOCKED");
    });

    it("nouveau mot de passe identique à l'ancien, trop court ou champ inconnu : refusés", async () => {
        const { agent } = await loginAs(app, request, "patient");
        const same = await change(agent, { currentPassword: PASSWORD, newPassword: PASSWORD });
        expect(same.status).toBe(400);
        expect(same.body.code).toBe("PASSWORD_UNCHANGED");
        expect((await change(agent, { currentPassword: PASSWORD, newPassword: "court" })).status).toBe(400);
        expect((await change(agent, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, role: "admin" })).status).toBe(400);
        expect((await change(agent, { newPassword: NEW_PASSWORD })).status).toBe(400);
    });

    it("connexion obligatoire", async () => {
        const res = await request(app).post("/api/auth/change-password").send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
        expect(res.status).toBe(401);
    });
});
