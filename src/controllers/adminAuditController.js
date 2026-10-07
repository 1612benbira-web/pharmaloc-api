const AuditLog = require("../models/AuditLog");

const view = (e) => ({
    id: e._id, createdAt: e.createdAt, action: e.action, target: e.target, meta: e.meta,
    actor: e.actor && e.actor.name !== undefined
        ? { id: e.actor._id, name: e.actor.name, email: e.actor.email, role: e.actor.role }
        : null
});

// Journal des actions sensibles, du plus récent au plus ancien. Réservé à l'administrateur (voir adminRoutes).
const listAudit = async (req, res) => {
    const { action, page, limit } = req.valid.query;
    const filter = action ? { action } : {};
    const [entries, total] = await Promise.all([
        AuditLog.find(filter).populate("actor", "name email role").sort({ createdAt: -1 })
            .skip((page - 1) * limit).limit(limit).lean(),
        AuditLog.countDocuments(filter)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(entries.map(view));
};

module.exports = { listAudit };
