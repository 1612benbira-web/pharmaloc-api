const mongoose = require("mongoose");

// Demande de réinitialisation de mot de passe. Seul le hash SHA-256 du jeton est stocké :
// une fuite de la base ne donne aucun lien utilisable. Usage unique, durée de vie courte.
const passwordResetSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        tokenHash: { type: String, required: true },
        expiresAt: { type: Date, required: true },
        usedAt: { type: Date }
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

passwordResetSchema.index({ tokenHash: 1 }, { unique: true });
passwordResetSchema.index({ user: 1 });
// MongoDB supprime automatiquement les demandes expirées.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PasswordReset", passwordResetSchema);
