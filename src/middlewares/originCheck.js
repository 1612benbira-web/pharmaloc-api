const AppError = require("../utils/AppError");

// Défense CSRF complémentaire à SameSite=Lax : une requête qui modifie des données et dont
// l'en-tête Origin est présent doit venir du même hôte ou d'une origine explicitement autorisée.
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

const originCheck = (allowedOrigins = []) => (req, res, next) => {
    const origin = req.get("Origin");
    if (SAFE.has(req.method) || !origin) return next();
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host === req.get("Host") || allowedOrigins.includes(origin)) return next();
    throw new AppError(403, "Origine non autorisée", "FORBIDDEN_ORIGIN");
};

module.exports = originCheck;
