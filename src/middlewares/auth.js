const AppError = require("../utils/AppError");
const { findUserByToken } = require("../services/authService");

const COOKIE_NAME = "pl_session";

// Avec un mot de passe provisoire, SEULES ces routes restent accessibles.
const ALLOWED_WITH_TEMPORARY_PASSWORD = new Set([
    "GET /api/auth/me",
    "POST /api/auth/change-password",
    "POST /api/auth/logout",
    "POST /api/auth/logout-all"
]);

function parseCookies(header) {
    const out = {};
    for (const part of String(header || "").split(";")) {
        const i = part.indexOf("=");
        if (i < 0) continue;
        const key = part.slice(0, i).trim();
        try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie mal formé : ignoré */ }
    }
    return out;
}

// Résolveur par défaut : cookie -> session en base. Remplaçable UNIQUEMENT par les tests.
async function defaultResolver(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    return findUserByToken(token); // { user, session } ou null
}
let resolver = defaultResolver;
const setSessionResolver = (fn) => { resolver = fn || defaultResolver; };

const authenticate = async (req, res, next) => {
    const found = await resolver(req);
    if (!found) throw new AppError(401, "Connexion requise", "UNAUTHENTICATED");
    req.user = found.user;
    req.session = found.session;

    if (req.user.mustChangePassword && !ALLOWED_WITH_TEMPORARY_PASSWORD.has(`${req.method} ${req.baseUrl}${req.path}`)) {
        throw new AppError(403, "Votre mot de passe est provisoire : changez-le avant de continuer", "PASSWORD_CHANGE_REQUIRED");
    }
    next();
};

const requireRole = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
        throw new AppError(403, "Action non autorisée pour votre rôle", "FORBIDDEN_ROLE");
    }
    next();
};

module.exports = { authenticate, requireRole, parseCookies, setSessionResolver, COOKIE_NAME };
