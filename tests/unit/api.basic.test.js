import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createRequire } from "module";
import createApp from "../../src/app.js";

// Modules CommonJS chargés via require : une seule instance partagée avec l'application.
const require = createRequire(import.meta.url);
const { setSessionResolver } = require("../../src/middlewares/auth");

const app = createApp();
const VALID_ID = "64b7f0c2a1b2c3d4e5f60718";
const OTHER_ID = "64b7f0c2a1b2c3d4e5f60719";

// Résolveur factice : l'utilisateur est lu dans l'en-tête x-test-user. Uniquement pour les tests.
beforeAll(() => setSessionResolver(async (req) => {
    const h = req.get("x-test-user");
    return h ? { user: JSON.parse(h), session: { _id: "s1" } } : null;
}));
afterAll(() => setSessionResolver(null));

const as = (role, pharmacies = [VALID_ID]) => JSON.stringify({ _id: VALID_ID, role, pharmacies });
const manager = as("pharmacy_manager");

describe("API - socle (sans base de données)", () => {
    it("health signale une base déconnectée (503) au lieu de mentir", async () => {
        const res = await request(app).get("/api/health");
        expect(res.status).toBe(503);
        expect(res.body.database).toBe("disconnected");
    });

    it("route inconnue -> 404 JSON uniforme", async () => {
        const res = await request(app).get("/api/nimporte");
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("ROUTE_NOT_FOUND");
    });

    it("JSON invalide -> 400 sans détail interne", async () => {
        const res = await request(app).post("/api/auth/login")
            .set("Content-Type", "application/json").send("{ pas du json");
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("INVALID_JSON");
    });

    it("ne divulgue pas la technologie (x-powered-by)", async () => {
        const res = await request(app).get("/");
        expect(res.headers["x-powered-by"]).toBeUndefined();
    });
});

describe("Authentification requise (401)", () => {
    const cases = [
        ["get", "/api/stocks"], ["post", "/api/stocks"], ["get", `/api/stocks/${VALID_ID}`],
        ["post", `/api/stocks/${VALID_ID}/movements`], ["get", "/api/deliveries"], ["post", "/api/deliveries"],
        ["post", "/api/medicines"], ["patch", `/api/medicines/${VALID_ID}`], ["delete", `/api/medicines/${VALID_ID}`],
        ["post", "/api/pharmacies"], ["patch", `/api/pharmacies/${VALID_ID}`], ["delete", `/api/pharmacies/${VALID_ID}`],
        ["post", "/api/admin/users"], ["get", "/api/auth/me"], ["post", "/api/auth/logout"]
    ];
    it.each(cases)("%s %s sans session -> 401", async (method, url) => {
        const res = await request(app)[method](url).send({});
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHENTICATED");
    });

    it("sans cookie de session, le résolveur réel refuse l'accès", async () => {
        setSessionResolver(null); // résolveur réel : sans base, aucune session ne peut être valide
        const res = await request(app).get("/api/auth/me");
        expect(res.status).toBe(401);
        setSessionResolver(async (req) => {
            const h = req.get("x-test-user");
            return h ? { user: JSON.parse(h), session: { _id: "s1" } } : null;
        });
    });
});

describe("Rôles (403)", () => {
    it("un patient ne peut accéder ni aux stocks ni aux livraisons", async () => {
        for (const url of ["/api/stocks", "/api/deliveries"]) {
            const res = await request(app).get(url).set("x-test-user", as("patient", []));
            expect(res.status, url).toBe(403);
            expect(res.body.code).toBe("FORBIDDEN_ROLE");
        }
    });

    it("un administrateur de plateforme n'accède pas aux stocks privés par défaut", async () => {
        const res = await request(app).get("/api/stocks").set("x-test-user", as("admin", []));
        expect(res.status).toBe(403);
    });

    it("un simple pharmacien ne peut pas créer/modifier/supprimer un stock", async () => {
        const h = as("pharmacist");
        expect((await request(app).post("/api/stocks").set("x-test-user", h).send({})).status).toBe(403);
        expect((await request(app).patch(`/api/stocks/${VALID_ID}`).set("x-test-user", h).send({})).status).toBe(403);
        expect((await request(app).delete(`/api/stocks/${VALID_ID}`).set("x-test-user", h)).status).toBe(403);
    });

    it("routes administrateur : refusées au personnel de pharmacie et aux patients", async () => {
        for (const role of ["patient", "pharmacist", "pharmacy_manager"]) {
            const res = await request(app).post("/api/admin/users").set("x-test-user", as(role)).send({});
            expect(res.status, role).toBe(403);
        }
    });

    it("créer une pharmacie ou supprimer un médicament : réservé à l'admin", async () => {
        expect((await request(app).post("/api/pharmacies").set("x-test-user", manager).send({})).status).toBe(403);
        expect((await request(app).delete(`/api/medicines/${VALID_ID}`).set("x-test-user", manager)).status).toBe(403);
    });

    it("un responsable ne peut pas modifier la pharmacie d'un autre", async () => {
        const res = await request(app).patch(`/api/pharmacies/${OTHER_ID}`)
            .set("x-test-user", manager).send({ name: "Piratée" });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN_PHARMACY");
    });

    it("créer un stock pour la pharmacie d'un autre -> 403", async () => {
        const res = await request(app).post("/api/stocks").set("x-test-user", manager)
            .send({ pharmacy: OTHER_ID, medicine: VALID_ID, quantity: 5 });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN_PHARMACY");
    });

    it("livraison vers la pharmacie d'un autre -> 403", async () => {
        const res = await request(app).post("/api/deliveries").set("x-test-user", as("pharmacist"))
            .send({ pharmacy: OTHER_ID, medicine: VALID_ID, quantity: 5 });
        expect(res.status).toBe(403);
    });
});

describe("Validation des entrées", () => {
    it("identifiant invalide -> 400 VALIDATION_ERROR", async () => {
        const res = await request(app).get("/api/stocks/abc").set("x-test-user", as("pharmacist"));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("livraison : quantité négative, nulle, décimale ou en texte refusée", async () => {
        for (const quantity of [-5, 0, 1.5, "10"]) {
            const res = await request(app).post("/api/deliveries").set("x-test-user", as("pharmacist"))
                .send({ pharmacy: VALID_ID, medicine: VALID_ID, quantity });
            expect(res.status, `quantity=${JSON.stringify(quantity)}`).toBe(400);
        }
    });

    it("livraison : champs manquants -> 400 avec détails par champ", async () => {
        const res = await request(app).post("/api/deliveries").set("x-test-user", as("pharmacist")).send({});
        expect(res.status).toBe(400);
        expect(res.body.details.map((d) => d.field)).toEqual(expect.arrayContaining(["pharmacy", "medicine", "quantity"]));
    });

    it("mouvement : type inconnu et quantité invalide refusés", async () => {
        const url = `/api/stocks/${VALID_ID}/movements`;
        const h = as("pharmacist");
        expect((await request(app).post(url).set("x-test-user", h).send({ type: "DELETE", quantity: 1 })).status).toBe(400);
        expect((await request(app).post(url).set("x-test-user", h).send({ type: "OUT", quantity: 0 })).status).toBe(400);
        expect((await request(app).post(url).set("x-test-user", h).send({ type: "OUT", quantity: -3 })).status).toBe(400);
    });

    it("clé d'idempotence trop courte refusée", async () => {
        const res = await request(app).post(`/api/stocks/${VALID_ID}/movements`)
            .set("x-test-user", as("pharmacist")).set("Idempotency-Key", "abc").send({ type: "OUT", quantity: 1 });
        expect(res.status).toBe(400);
    });

    it("PATCH stock : modifier la quantité directement est refusé", async () => {
        const res = await request(app).patch(`/api/stocks/${VALID_ID}`).set("x-test-user", manager)
            .send({ minimumQuantity: 5, quantity: 9999 });
        expect(res.status).toBe(400);
        expect(res.body.details[0].field).toBe("quantity");
    });

    it("inscription : mot de passe faible et e-mail invalide refusés", async () => {
        const base = { name: "Awa Diop", email: "awa@exemple.sn", password: "MotDePasse2026!" };
        expect((await request(app).post("/api/auth/register").send({ ...base, password: "court" })).status).toBe(400);
        expect((await request(app).post("/api/auth/register").send({ ...base, email: "pas-un-email" })).status).toBe(400);
        expect((await request(app).post("/api/auth/register").send({})).status).toBe(400);
    });

    it("l'admin ne peut pas créer un compte avec un rôle non admissible (patient)", async () => {
        const res = await request(app).post("/api/admin/users").set("x-test-user", as("admin", []))
            .send({ name: "Ibou", email: "ibou@exemple.sn", password: "MotDePasse2026!", role: "patient" });
        expect(res.status).toBe(400); // "patient" n'est pas un rôle admissible ici
    });
});

describe("Protection CSRF (contrôle d'origine)", () => {
    it("requête modifiante venant d'une origine étrangère -> 403", async () => {
        const res = await request(app).post("/api/auth/login").set("Origin", "https://site-malveillant.example")
            .send({ email: "a@b.sn", password: "x" });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN_ORIGIN");
    });
});
