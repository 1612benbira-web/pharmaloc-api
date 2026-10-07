const audit = require("../services/auditService");

/**
 * Journalise une action sensible APRÈS son succès (réponse < 400) : une action refusée n'est jamais journalisée.
 * Se place après la validation et avant le contrôleur. N'écrit jamais de mot de passe ni de valeur personnelle :
 * `meta` ne doit contenir que des noms de champs, des motifs et des états.
 *  - action : texte, ou fonction (req) => texte ;
 *  - target : (req, body) => identifiant de la cible (par défaut : req.params.id) ;
 *  - meta   : (req, body) => détails ;
 *  - skip   : (req, body) => true pour ne pas journaliser (par exemple une réponse rejouée).
 */
const auditAction = (action, { target, meta, skip } = {}) => (req, res, next) => {
    const send = res.json.bind(res);
    let body;
    res.json = (payload) => {
        body = payload;
        return send(payload);
    };
    res.on("finish", () => {
        if (res.statusCode >= 400 || (skip && skip(req, body))) return;
        audit.record({
            actor: req.user && req.user._id,
            action: typeof action === "function" ? action(req, body) : action,
            target: target ? target(req, body) : req.params && req.params.id,
            meta: meta ? meta(req, body) : undefined
        });
    });
    next();
};

module.exports = { auditAction };
