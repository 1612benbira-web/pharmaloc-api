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

module.exports = {
    nodeEnv,
    isProduction,
    port: Number(process.env.PORT) || 3000,
    // Origines web autorisées à envoyer des requêtes modifiantes (ex. le futur frontend), séparées par des virgules.
    allowedOrigins: (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean),
    getMongoUri
};
