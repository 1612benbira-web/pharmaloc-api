const AppError = require("../utils/AppError");

// Limiteur à fenêtre fixe, EN MÉMOIRE : suffisant pour un seul serveur.
// Avec plusieurs instances, il faudra un stockage partagé (Redis) pour que les compteurs soient communs.
function createRateLimiter({
    windowMs, max, key = (req) => req.ip, code = "RATE_LIMITED",
    message = "Trop de requêtes : réessayez dans quelques instants", now = Date.now
} = {}) {
    if (!(windowMs > 0) || !(max > 0)) throw new Error("rateLimit : windowMs et max doivent être positifs");

    const hits = new Map(); // clé -> { count, resetAt }
    let lastPurge = now();

    // Les compteurs expirés sont retirés régulièrement, pour que la mémoire ne grossisse pas indéfiniment.
    function purge(t) {
        for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
        lastPurge = t;
    }

    return function rateLimit(req, res, next) {
        const t = now();
        if (t - lastPurge >= windowMs || (hits.size > 50000 && t - lastPurge >= 1000)) purge(t);

        const k = String(key(req) ?? "anonyme");
        let entry = hits.get(k);
        if (!entry || entry.resetAt <= t) {
            entry = { count: 0, resetAt: t + windowMs };
            hits.set(k, entry);
        }
        entry.count++;

        const resetIn = Math.ceil((entry.resetAt - t) / 1000);
        res.set("RateLimit-Limit", String(max));
        res.set("RateLimit-Remaining", String(Math.max(0, max - entry.count)));
        res.set("RateLimit-Reset", String(resetIn));

        if (entry.count > max) {
            res.set("Retry-After", String(resetIn));
            throw new AppError(429, message, code, { retryAfterSeconds: resetIn });
        }
        next();
    };
}

const passthrough = (req, res, next) => next();
const accountKey = (req) => String((req.body && req.body.email) || "").trim().toLowerCase().slice(0, 254);

// Les limiteurs de l'application. `enabled: false` les remplace par des passe-plats (tests, développement).
function createLimiters(opts = {}) {
    const { enabled = true, now } = opts;
    if (!enabled) return { global: passthrough, loginByIp: passthrough, loginByAccount: passthrough, register: passthrough };

    const o = { globalMax: 300, loginIpMax: 30, loginAccountMax: 8, registerMax: 10, ...opts };
    const loginMessage = "Trop de tentatives de connexion : réessayez dans quelques minutes";
    return {
        global: createRateLimiter({ windowMs: 60 * 1000, max: o.globalMax, now }),
        loginByIp: createRateLimiter({
            windowMs: 15 * 60 * 1000, max: o.loginIpMax, code: "TOO_MANY_LOGIN_ATTEMPTS", message: loginMessage, now
        }),
        // Ralentit les essais ciblés sur un même compte depuis une même adresse.
        loginByAccount: createRateLimiter({
            windowMs: 15 * 60 * 1000, max: o.loginAccountMax, key: (req) => `${req.ip}|${accountKey(req)}`,
            code: "TOO_MANY_LOGIN_ATTEMPTS", message: loginMessage, now
        }),
        register: createRateLimiter({
            windowMs: 60 * 60 * 1000, max: o.registerMax, code: "TOO_MANY_REGISTRATIONS",
            message: "Trop de créations de compte depuis cette adresse : réessayez plus tard", now
        })
    };
}

module.exports = { createRateLimiter, createLimiters };