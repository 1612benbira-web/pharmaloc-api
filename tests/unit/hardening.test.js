import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createRequire } from "module";
import createApp from "../../src/app.js";

const require = createRequire(import.meta.url);
const { createRateLimiter } = require("../../src/middlewares/rateLimit");
const securityHeaders = require("../../src/middlewares/securityHeaders");
const { errorHandler } = require("../../src/middlewares/errorHandler");
const { checkProductionConfig } = require("../../src/config/env");

// Petite application avec une horloge contrôlée, pour tester le limiteur sans attendre.
function limitedApp(options) {
    const app = express();
    app.use(createRateLimiter(options));
    app.get("/", (req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    return app;
}

describe("Limiteur de débit", () => {
    const byHeader = (req) => req.get("x-key");

    it("laisse passer jusqu'au maximum, puis refuse avec 429 et Retry-After", async () => {
        const app = limitedApp({ windowMs: 60000, max: 3, key: byHeader, now: () => 0 });
        for (let i = 0; i < 3; i++) expect((await request(app).get("/").set("x-key", "a")).status).toBe(200);
        const blocked = await request(app).get("/").set("x-key", "a");
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe("RATE_LIMITED");
        expect(blocked.headers["retry-after"]).toBe("60");
        expect(blocked.headers["ratelimit-remaining"]).toBe("0");
    });

    it("repart à zéro après la fenêtre", async () => {
        let t = 0;
        const app = limitedApp({ windowMs: 60000, max: 1, key: byHeader, now: () => t });
        expect((await request(app).get("/").set("x-key", "a")).status).toBe(200);
        expect((await request(app).get("/").set("x-key", "a")).status).toBe(429);
        t = 60001;
        expect((await request(app).get("/").set("x-key", "a")).status).toBe(200);
    });

    it("les clés sont indépendantes ; le compteur restant diminue", async () => {
        const app = limitedApp({ windowMs: 60000, max: 2, key: byHeader, now: () => 0 });
        const first = await request(app).get("/").set("x-key", "a");
        expect(first.headers["ratelimit-remaining"]).toBe("1");
        await request(app).get("/").set("x-key", "a");
        expect((await request(app).get("/").set("x-key", "a")).status).toBe(429);
        expect((await request(app).get("/").set("x-key", "b")).status).toBe(200);
    });

    it("configuration invalide refusée", () => {
        expect(() => createRateLimiter({ windowMs: 0, max: 5 })).toThrow();
        expect(() => createRateLimiter({ windowMs: 1000, max: 0 })).toThrow();
    });
});

describe("Limitation de débit dans l'application", () => {
    it("connexion : trop de tentatives depuis une adresse -> 429, avant même la base de données", async () => {
        const app = createApp({ rateLimit: { enabled: true, loginIpMax: 3 } });
        for (let i = 0; i < 3; i++) expect((await request(app).post("/api/auth/login").send({})).status).toBe(400);
        const blocked = await request(app).post("/api/auth/login").send({});
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe("TOO_MANY_LOGIN_ATTEMPTS");
        expect(blocked.headers["retry-after"]).toBeDefined();
    });

    it("connexion : les essais sur un même compte sont limités, pas ceux sur un autre", async () => {
        const app = createApp({ rateLimit: { enabled: true, loginIpMax: 100, loginAccountMax: 2 } });
        const attempt = (email) => request(app).post("/api/auth/login").send({ email });
        expect((await attempt("cible@exemple.sn")).status).toBe(400);
        expect((await attempt("CIBLE@exemple.sn")).status).toBe(400); // même compte, casse différente
        expect((await attempt("cible@exemple.sn")).status).toBe(429);
        expect((await attempt("autre@exemple.sn")).status).toBe(400);
    });

    it("inscription : limitée par adresse", async () => {
        const app = createApp({ rateLimit: { enabled: true, registerMax: 2 } });
        for (let i = 0; i < 2; i++) expect((await request(app).post("/api/auth/register").send({})).status).toBe(400);
        const blocked = await request(app).post("/api/auth/register").send({});
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe("TOO_MANY_REGISTRATIONS");
    });

    it("limite globale sur toute l'API", async () => {
        const app = createApp({ rateLimit: { enabled: true, globalMax: 3 } });
        for (let i = 0; i < 3; i++) expect((await request(app).get("/api/nimporte")).status).toBe(404);
        expect((await request(app).get("/api/nimporte")).status).toBe(429);
    });

    it("désactivée par défaut pendant les tests", async () => {
        const app = createApp();
        for (let i = 0; i < 40; i++) expect((await request(app).post("/api/auth/login").send({})).status).toBe(400);
    });
});

describe("CORS", () => {
    const ORIGIN = "https://app.exemple.sn";
    const app = createApp({ allowedOrigins: [ORIGIN] });

    it("pré-vérification depuis une origine autorisée : 204 avec cookies autorisés", async () => {
        const res = await request(app).options("/api/orders")
            .set("Origin", ORIGIN).set("Access-Control-Request-Method", "POST");
        expect(res.status).toBe(204);
        expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
        expect(res.headers["access-control-allow-credentials"]).toBe("true");
        expect(res.headers["access-control-allow-headers"]).toContain("Idempotency-Key");
        expect(res.headers.vary).toContain("Origin");
    });

    it("requête réelle depuis l'origine autorisée : passe le contrôle CSRF et expose X-Total-Count", async () => {
        const res = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({});
        expect(res.status).toBe(400); // et non 403 FORBIDDEN_ORIGIN
        expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
        expect(res.headers["access-control-expose-headers"]).toContain("X-Total-Count");
    });

    it("origine inconnue : aucun en-tête CORS ; sans Origin : aucun en-tête CORS", async () => {
        const stranger = await request(app).options("/api/orders")
            .set("Origin", "https://pirate.example").set("Access-Control-Request-Method", "POST");
        expect(stranger.headers["access-control-allow-origin"]).toBeUndefined();
        const none = await request(app).get("/");
        expect(none.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("jamais de joker avec les cookies", async () => {
        const res = await request(app).options("/api/orders")
            .set("Origin", ORIGIN).set("Access-Control-Request-Method", "GET");
        expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    });
});

describe("En-têtes de sécurité", () => {
    it("présents sur toutes les réponses, sans HSTS hors production", async () => {
        const res = await request(createApp()).get("/");
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers["x-frame-options"]).toBe("DENY");
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.headers["referrer-policy"]).toBe("no-referrer");
        expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
        expect(res.headers["strict-transport-security"]).toBeUndefined();
    });

    it("HSTS uniquement en production", async () => {
        const app = express();
        app.use(securityHeaders({ isProduction: true }));
        app.get("/", (req, res) => res.json({}));
        const res = await request(app).get("/");
        expect(res.headers["strict-transport-security"]).toContain("max-age=");
    });
});

describe("Vérification de la configuration de production", () => {
    const good = {
        MONGODB_URI: "mongodb://app:motdepasse@db.exemple.sn:27017/pharmaloc?authSource=pharmaloc",
        ALLOWED_ORIGINS: "https://app.exemple.sn",
        TRUST_PROXY: "1"
    };

    it("configuration correcte : ni erreur ni avertissement", () => {
        expect(checkProductionConfig(good)).toEqual({ errors: [], warnings: [] });
        expect(checkProductionConfig({ ...good, MONGODB_URI: "mongodb+srv://u:p@cluster.exemple.net/pharmaloc" }).errors).toEqual([]);
    });

    it("base absente ou sans identifiants : refusée", () => {
        expect(checkProductionConfig({ ...good, MONGODB_URI: undefined }).errors).toHaveLength(1);
        expect(checkProductionConfig({ ...good, MONGODB_URI: "mongodb://127.0.0.1:27017/pharmaloc" }).errors[0]).toContain("identifiants");
    });

    it("limiteur coupé : refusé", () => {
        expect(checkProductionConfig({ ...good, RATE_LIMIT: "off" }).errors[0]).toContain("RATE_LIMIT");
    });

    it("origines : joker, http et slash final refusés", () => {
        for (const bad of ["*", "http://app.exemple.sn", "https://app.exemple.sn/"]) {
            expect(checkProductionConfig({ ...good, ALLOWED_ORIGINS: bad }).errors, bad).toHaveLength(1);
        }
    });

    it("TRUST_PROXY absent : simple avertissement", () => {
        const result = checkProductionConfig({ ...good, TRUST_PROXY: undefined });
        expect(result.errors).toEqual([]);
        expect(result.warnings).toHaveLength(1);
    });
});