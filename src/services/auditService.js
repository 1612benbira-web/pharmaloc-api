const AuditLog = require("../models/AuditLog");

// Ne doit jamais faire échouer l'opération principale, mais l'échec est signalé.
async function record({ actor, action, target, meta }) {
    try {
        await AuditLog.create({ actor, action, target, meta });
    } catch (err) {
        console.error("Échec d'écriture du journal d'audit :", err.message);
    }
}

module.exports = { record };
