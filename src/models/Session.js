const mongoose = require("mongoose");

// [NOUVEAU v2] Session côté serveur : révocable à tout moment.
// Seul le hash SHA-256 du jeton est stocké : une fuite de la base ne donne pas de sessions valides.
const sessionSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        tokenHash: { type: String, required: true },
        expiresAt: { type: Date, required: true },
        revokedAt: { type: Date },
        userAgent: { type: String, maxlength: 300 }
    },
    { timestamps: true }
);

sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ user: 1 });
// MongoDB supprime automatiquement les sessions expirées.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Session", sessionSchema);
