// CORS pour un frontend servi depuis une AUTRE origine. Liste blanche stricte : jamais "*",
// car les cookies de session sont envoyés (le frontend doit utiliser credentials: "include").
const ALLOW_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const ALLOW_HEADERS = "Content-Type, Idempotency-Key";
const EXPOSE_HEADERS = "X-Total-Count, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After";

const cors = (allowedOrigins = []) => (req, res, next) => {
    const origin = req.get("Origin");
    if (!origin) return next();

    res.vary("Origin");
    if (!allowedOrigins.includes(origin)) return next(); // aucun en-tête CORS : le navigateur bloquera

    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Credentials", "true");
    res.set("Access-Control-Expose-Headers", EXPOSE_HEADERS);

    // Requête de pré-vérification du navigateur : on répond sans traiter la route.
    if (req.method === "OPTIONS" && req.get("Access-Control-Request-Method")) {
        res.set("Access-Control-Allow-Methods", ALLOW_METHODS);
        res.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
        res.set("Access-Control-Max-Age", "600");
        return res.status(204).end();
    }
    next();
};

module.exports = cors;