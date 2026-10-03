// Configuration centralisée. Aucune valeur secrète n'est écrite dans le code.
require("dotenv").config({ quiet: true });

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

// Valeur par défaut = celle qui était codée en dur avant (compatibilité dev).
const DEV_DEFAULT_URI = "mongodb://127.0.0.1:27017/pharmaloc";

function getMongoUri() {
    const uri = process.env.MONGODB_URI || (isProduction ? null : DEV_DEFAULT_URI);
    if (!uri) {
        throw new Error("MONGODB_URI est obligatoire en production");
    }
    return uri;
}

const parseList = (value) => (value || "").split(",").map((o) => o.trim()).filter(Boolean);

// Nombre de proxys inversés de confiance devant l'API (0 = aucun). Il sert à lire la vraie adresse IP du client,
// donc à faire fonctionner la limitation de débit derrière un reverse proxy.
function parseTrustProxy(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}

/**
 * Vérifie qu'une configuration de PRODUCTION est sûre. Fonction pure (testable) :
 * `errors` empêchent le démarrage, `warnings` sont seulement affichés.
 */
function checkProductionConfig(env = process.env) {
    const errors = [];
    const warnings = [];

    const uri = env.MONGODB_URI;
    if (!uri) {
        errors.push("MONGODB_URI est obligatoire.");
    } else if (!/^mongodb(?:\+srv)?:\/\/[^/@\s]+@/.test(uri)) {
        errors.push("MONGODB_URI ne contient pas d'identifiants : activez l'authentification MongoDB.");
    }
    if (env.RATE_LIMIT === "off") errors.push("RATE_LIMIT=off est interdit en production.");
    for (const origin of parseList(env.ALLOWED_ORIGINS)) {
        if (!/^https:\/\/[^/*\s]+$/.test(origin)) {
            errors.push(`ALLOWED_ORIGINS : « ${origin} » n'est pas une origine https valide (sans slash final ni joker).`);
        }
    }
    if (parseTrustProxy(env.TRUST_PROXY) === 0) {
        warnings.push("TRUST_PROXY n'est pas défini : derrière un reverse proxy, tous les clients paraîtront avoir la même adresse IP et la limitation de débit sera inefficace. Indiquez le nombre de proxys (souvent 1).");
    }
    return { errors, warnings };
}

module.exports = {
    nodeEnv,
    isProduction,
    port: Number(process.env.PORT) || 3000,
    // Origines web autorisées (CORS et contrôle CSRF) : celles du frontend, séparées par des virgules.
    allowedOrigins: parseList(process.env.ALLOWED_ORIGINS),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    // Active par défaut ; coupée pendant les tests. RATE_LIMIT=off la coupe en développement (interdit en production).
    rateLimitEnabled: nodeEnv === "test" ? false : process.env.RATE_LIMIT !== "off",
    getMongoUri,
    checkProductionConfig
};