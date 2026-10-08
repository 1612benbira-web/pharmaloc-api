import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createRequire } from "module";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, loginAs, User, PASSWORD } from "./helpers.js";

const require = createRequire(import.meta.url);
const mailer = require("../../src/services/mailer");
const PasswordReset = require("../../src/models/PasswordReset");

const app = createApp();
const sent = [];
beforeAll(async () => {
    await startTestDb();
    mailer.setTransport({ sendMail: async (message) => { sent.push(message); } });
}, 120000);
afterAll(async () => { mailer.setTransport(null); await stopTestDb(); });
beforeEach(async () => { sent.length = 0; await resetDb(); await PasswordReset.deleteMany({}); });

const NEW_PASSWORD = "Nouveau-Mot-De-Passe-2026";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const forgot = (email) => request(app).post("/api/auth/forgot-password").send({ email });
const reset = (token, newPassword = NEW_PASSWORD) => request(app).post("/api/auth/reset-password").send({ token, newPassword });
const login = (email, password) => request(app).post("/api/auth/login").send({ email, password });

// L'e-mail part en arrière-plan : on attend qu'il apparaisse.
async function mailCount(n, tries = 40) {
    for (let i = 0; i < tries && sent.length < n; i++) await sleep(50);
    return sent.length;
}
const tokenOf = (message) => /token=([a-f0-9]{64})/.exec(message.text)[1];

describe("Mot de passe oublié", () => {
    it("parcours complet : e-mail, nouveau mot de passe, ancien refusé, lien à usage unique, autres sessions fermées", async () => {
        const { agent, email } = await loginAs(app, request, "patient");
        const res = await forgot(email);
        expect(res.status).toBe(202);
        expect(await mailCount(1)).toBe(1);
        expect(sent[0].to).toBe(email);
        expect(sent[0].text).toContain("/reinitialiser?token=");
        const token = tokenOf(sent[0]);

        const done = await reset(token);
        expect(done.status).toBe(200);
        expect((await login(email, PASSWORD)).status).toBe(401);
        expect((await login(email, NEW_PASSWORD)).status).toBe(200);
        expect((await agent.get("/api/auth/me")).status).toBe(401);

        const again = await reset(token, "Un-Autre-Mot-De-Passe-2026");
        expect(again.status).toBe(400);
        expect(again.body.code).toBe("INVALID_RESET_TOKEN");
    });

    it("la réponse est la même pour un compte inconnu, et aucun e-mail ne part", async () => {
        const { email } = await loginAs(app, request, "patient");
        const known = await forgot(email);
        const unknown = await forgot("personne@exemple.sn");
        expect(unknown.status).toBe(202);
        expect(unknown.body).toEqual(known.body);
        await mailCount(1);
        await sleep(300);
        expect(sent).toHaveLength(1);
    });

    it("un compte suspendu ne reçoit rien", async () => {
        const { email, user } = await loginAs(app, request, "courier", []);
        await User.updateOne({ _id: user._id }, { isActive: false });
        expect((await forgot(email)).status).toBe(202);
        await sleep(400);
        expect(sent).toHaveLength(0);
    });

    it("le jeton n'est stocké qu'en hash ; un nouveau lien invalide le précédent", async () => {
        const { email } = await loginAs(app, request, "patient");
        await forgot(email);
        await mailCount(1);
        const first = tokenOf(sent[0]);
        const stored = await PasswordReset.findOne();
        expect(stored.tokenHash).toHaveLength(64);
        expect(stored.tokenHash).not.toBe(first);

        await forgot(email);
        await mailCount(2);
        expect((await reset(first)).status).toBe(400);
        expect((await reset(tokenOf(sent[1]))).status).toBe(200);
    });

    it("lien expiré, jeton inventé ou mal formé : refusés", async () => {
        const { email } = await loginAs(app, request, "patient");
        await forgot(email);
        await mailCount(1);
        const token = tokenOf(sent[0]);
        await PasswordReset.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });

        expect((await reset(token)).body.code).toBe("INVALID_RESET_TOKEN");
        expect((await reset("a".repeat(64))).body.code).toBe("INVALID_RESET_TOKEN");
        expect((await reset("pas-un-jeton")).status).toBe(400);
        expect((await login(email, PASSWORD)).status).toBe(200);
    });

    it("mot de passe trop court : refusé, et le lien reste utilisable", async () => {
        const { email } = await loginAs(app, request, "patient");
        await forgot(email);
        await mailCount(1);
        const token = tokenOf(sent[0]);
        expect((await reset(token, "court")).status).toBe(400);
        expect((await reset(token)).status).toBe(200);
    });

    it("la réinitialisation déverrouille un compte bloqué", async () => {
        const { email } = await loginAs(app, request, "patient");
        for (let i = 0; i < 5; i++) await login(email, "mauvais-mot-de-passe");
        expect((await login(email, PASSWORD)).status).toBe(429);

        await forgot(email);
        await mailCount(1);
        expect((await reset(tokenOf(sent[0]))).status).toBe(200);
        expect((await login(email, NEW_PASSWORD)).status).toBe(200);
    });

    it("corps invalide : adresse mal formée ou champ inconnu refusés", async () => {
        expect((await forgot("pas-un-email")).status).toBe(400);
        expect((await request(app).post("/api/auth/forgot-password").send({ email: "a@exemple.sn", role: "admin" })).status).toBe(400);
    });
});
