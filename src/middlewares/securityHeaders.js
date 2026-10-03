// En-têtes de sécurité d'une API JSON.
const securityHeaders = ({ isProduction = false } = {}) => (req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    res.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    // Les réponses contiennent des données privées (stocks, commandes) : jamais de cache.
    res.set("Cache-Control", "no-store");
    // HTTPS obligatoire pour les navigateurs : uniquement en production (derrière HTTPS).
    if (isProduction) res.set("Strict-Transport-Security", "max-age=15552000");
    next();
};

module.exports = securityHeaders;