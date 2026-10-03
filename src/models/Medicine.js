const mongoose = require("mongoose");

const medicineSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        genericName: {
            type: String,
            trim: true
        },

        laboratory: {
            type: String,
            trim: true
        },

        category: {
            type: String,
            trim: true
        },

        dosage: {
            type: String,
            trim: true
        },

        form: {
            type: String,
            trim: true
        },

        // [v2] Champs du catalogue (aucune donnée médicale n'est inventée : tout est optionnel)
        activeIngredient: { type: String, trim: true },
        packaging: { type: String, trim: true },
        sourceReference: { type: String, trim: true },
        isActive: { type: Boolean, default: true },

        prescriptionRequired: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true
    }
);

medicineSchema.index({ name: 1 });
medicineSchema.index({ genericName: 1 });
medicineSchema.index({ activeIngredient: 1 });

const Medicine = mongoose.model("Medicine", medicineSchema);

module.exports = Medicine;