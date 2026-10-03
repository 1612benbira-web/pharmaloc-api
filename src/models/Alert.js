const mongoose = require("mongoose");

// [NOUVEAU v2] Une alerte = un incident. L'index unique (pharmacy, dedupeKey) garantit
// qu'un même incident ne crée jamais deux alertes.
const alertSchema = new mongoose.Schema(
    {
        pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },
        type: { type: String, required: true },
        severity: { type: String, enum: ["INFO", "WARNING", "CRITICAL"], required: true },
        dedupeKey: { type: String, required: true },
        message: { type: String, required: true },
        data: { type: mongoose.Schema.Types.Mixed },
        status: { type: String, enum: ["OPEN", "ACKNOWLEDGED", "RESOLVED"], default: "OPEN" },
        firstSeenAt: { type: Date },
        lastSeenAt: { type: Date },
        resolvedAt: { type: Date },
        acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    { timestamps: true }
);

alertSchema.index({ pharmacy: 1, dedupeKey: 1 }, { unique: true });
alertSchema.index({ pharmacy: 1, status: 1, severity: 1 });

module.exports = mongoose.model("Alert", alertSchema);
