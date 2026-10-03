const mongoose = require("mongoose");

// [NOUVEAU v2] Fournisseur propre à une pharmacie. Aucune intégration API n'est supposée.
const supplierSchema = new mongoose.Schema(
    {
        pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },
        name: { type: String, required: true, trim: true, maxlength: 120 },
        phone: { type: String, trim: true, maxlength: 40 },
        email: { type: String, trim: true, lowercase: true, maxlength: 120 },
        isActive: { type: Boolean, default: true }
    },
    { timestamps: true }
);

supplierSchema.index({ pharmacy: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Supplier", supplierSchema);
