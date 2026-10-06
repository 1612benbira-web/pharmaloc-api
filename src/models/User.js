const mongoose = require("mongoose");

// Modèle reconstruit à partir de authService, accessService, authValidators et des tests.
// Le hachage du mot de passe se fait dans passwordService (scrypt), pas ici.
const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        // Jamais renvoyé par défaut : authService.login le demande avec .select("+passwordHash")
        passwordHash: { type: String, required: true, select: false },

        role: {
            type: String,
            enum: ["patient", "pharmacist", "pharmacy_manager", "courier", "admin"],
            default: "patient"
        },

        // Pharmacies auxquelles le personnel ou le livreur est affecté (vide pour un patient ou un admin)
        pharmacies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" }],

        isActive: { type: Boolean, default: true },

        // true pour un compte créé par un administrateur avec un mot de passe provisoire :
        // tant qu'il n'est pas changé, l'API refuse tout sauf le changement de mot de passe.
        mustChangePassword: { type: Boolean, default: false },

        // Verrouillage après 5 échecs de connexion
        failedLoginCount: { type: Number, default: 0 },
        lockUntil: { type: Date }
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
