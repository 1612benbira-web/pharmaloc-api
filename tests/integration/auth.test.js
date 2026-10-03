import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, loginAs, User, Session, AuditLog, PASSWORD } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

const newAccount = { name: "Awa Diop", email: "awa@exemple.sn", password: PASSWORD };

describe("Inscription et connexion", () => {
    it("inscription : crée un patient, sans jamais exposer le hash du mot de passe", async () => {
        const res = await request(app).post("/api/auth/register").send(newAccount);
        expect(res.status).toBe(201);
        expect(res.body.user.role).toBe("patient");
        expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);
        const stored = await User.findOne({ email: newAccount.email }).select("+passwordHash");
        expect(stored.passwordHash).not.toContain(PASSWORD);
    });

    it("inscription : impossible de s'attribuer un rôle ou des pharmacies", async () => {
        const { pharmacy } = await seedStock(0);
        const res = await request(app).post("/api/auth/register")
            .send({ ...newAccount, role: "admin", pharmacies: [pharmacy._id] });
        expect(res.status).toBe(201);
        const stored = await User.findOne({ email: newAccount.email });
        expect(stored.role).toBe("patient");
        expect(stored.pharmacies).toHaveLength(0);
    });

    it("inscription : e-mail déjà utilisé -> 409", async () => {
        await request(app).post("/api/auth/register").send(newAccount);
        const res = await request(app).post("/api/auth/register").send({ ...newAccount, email: "AWA@exemple.sn" });
        expect(res.status).toBe(409);
    });

    it("connexion : cookie HttpOnly + SameSite, jeton absent du corps de la réponse", async () => {
        await request(app).post("/api/auth/register").send(newAccount);
        const res = await request(app).post("/api/auth/login").send({ email: newAccount.email, password: PASSWORD });
        expect(res.status).toBe(200);
        const cookie = res.headers["set-cookie"].join(";");
        expect(cookie).toMatch(/pl_session=/);
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
        expect(JSON.stringify(res.body)).not.toMatch(/token|pl_session/i);
    });

    it("le jeton n'est stocké qu'en hash en base", async () => {
        await request(app).post("/api/auth/register").send(newAccount);
        const res = await request(app).post("/api/auth/login").send({ email: newAccount.email, password: PASSWORD });
        const token = /pl_session=([^;]+)/.exec(res.headers["set-cookie"][0])[1];
        const session = await Session.findOne();
        expect(session.tokenHash).not.toBe(token);
        expect(session.tokenHash).toHaveLength(64);
    });

    it("mauvais mot de passe et e-mail inconnu : même réponse (pas d'énumération de comptes)", async () => {
        await request(app).post("/api/auth/register").send(newAccount);
        const wrong = await request(app).post("/api/auth/login").send({ email: newAccount.email, password: "mauvais-mot-de-passe" });
        const unknown = await request(app).post("/api/auth/login").send({ email: "inconnu@exemple.sn", password: "mauvais-mot-de-passe" });
        expect(wrong.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(wrong.body).toEqual(unknown.body);
    });

    it("5 échecs verrouillent le compte, même avec le bon mot de passe ensuite", async () => {
        await request(app).post("/api/auth/register").send(newAccount);
        for (let i = 0; i < 5; i++) {
            await request(app).post("/api/auth/login").send({ email: newAccount.email, password: "mauvais-mot-de-passe" });
        }
        const res = await request(app).post("/api/auth/login").send({ email: newAccount.email, password: PASSWORD });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe("ACCOUNT_LOCKED");
    });

    it("compte désactivé : connexion refusée", async () => {
        await request(app).post("/api/auth/register").send(newAccount);
        await User.updateOne({ email: newAccount.email }, { isActive: false });
        const res = await request(app).post("/api/auth/login").send({ email: newAccount.email, password: PASSWORD });
        expect(res.status).toBe(401);
    });
});

describe("Sessions", () => {
    it("/me fonctionne connecté ; la déconnexion révoque réellement la session", async () => {
        const { email } = await loginAs(app, request, "patient");
        const login = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
        const cookie = login.headers["set-cookie"][0].split(";")[0]; // "pl_session=<jeton>"

        expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
        expect((await request(app).post("/api/auth/logout").set("Cookie", cookie)).status).toBe(200);
        // Rejouer l'ancien cookie après déconnexion : la session révoquée est refusée.
        expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
    });

    it("logout-all révoque toutes les sessions de l'utilisateur", async () => {
        const { agent, email } = await loginAs(app, request, "patient");
        const second = request.agent(app);
        await second.post("/api/auth/login").send({ email, password: PASSWORD });
        expect((await agent.post("/api/auth/logout-all")).status).toBe(200);
        expect((await second.get("/api/auth/me")).status).toBe(401);
    });

    it("session expirée refusée", async () => {
        const { agent } = await loginAs(app, request, "patient");
        await Session.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
        expect((await agent.get("/api/auth/me")).status).toBe(401);
    });

    it("désactiver un compte coupe ses sessions existantes", async () => {
        const { agent, user } = await loginAs(app, request, "patient");
        await User.updateOne({ _id: user._id }, { isActive: false });
        expect((await agent.get("/api/auth/me")).status).toBe(401);
    });
});

describe("Administration", () => {
    it("un admin crée un pharmacien affecté à une pharmacie, l'action est journalisée", async () => {
        const { pharmacy } = await seedStock(0);
        const admin = await loginAs(app, request, "admin", []);
        const res = await admin.agent.post("/api/admin/users").send({
            name: "Moussa Ba", email: "moussa@exemple.sn", password: PASSWORD,
            role: "pharmacist", pharmacies: [String(pharmacy._id)]
        });
        expect(res.status).toBe(201);
        expect(res.body.user.pharmacies).toEqual([String(pharmacy._id)]);
        const log = await AuditLog.findOne({ action: "USER_CREATED" });
        expect(String(log.actor)).toBe(String(admin.user._id));
        expect(JSON.stringify(log)).not.toContain(PASSWORD);
    });

    it("pharmacien sans pharmacie ou pharmacie inexistante : refusé", async () => {
        const admin = await loginAs(app, request, "admin", []);
        const base = { name: "Moussa Ba", email: "moussa@exemple.sn", password: PASSWORD, role: "pharmacist" };
        expect((await admin.agent.post("/api/admin/users").send({ ...base, pharmacies: [] })).status).toBe(400);
        expect((await admin.agent.post("/api/admin/users")
            .send({ ...base, pharmacies: ["64b7f0c2a1b2c3d4e5f60718"] })).status).toBe(404);
    });

    it("un pharmacien ne peut pas créer de comptes", async () => {
        const { pharmacy } = await seedStock(0);
        const staff = await loginAs(app, request, "pharmacy_manager", [pharmacy._id]);
        const res = await staff.agent.post("/api/admin/users").send({
            name: "X Y", email: "x@exemple.sn", password: PASSWORD, role: "admin", pharmacies: []
        });
        expect(res.status).toBe(403);
    });
});
