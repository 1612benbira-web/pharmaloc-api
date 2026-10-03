const mongoose = require("mongoose");

// [NOUVEAU v2] Journal d'audit des opérations sensibles. Jamais de mot de passe ni de jeton dedans.
const auditLogSchema = new mongoose.Schema(
    {
        actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        action: { type: String, required: true },
        target: { type: String },
        meta: { type: mongoose.Schema.Types.Mixed }
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
