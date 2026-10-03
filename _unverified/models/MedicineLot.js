const mongoose = require("mongoose");

// [NOUVEAU v2] "Périmé" n'est PAS un statut stocké : il se déduit de expiryDate (jamais périmé par oubli).
const medicineLotSchema = new mongoose.Schema(
    {
        stock: { type: mongoose.Schema.Types.ObjectId, ref: "Stock", required: true },
        pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },
        medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
        lotNumber: { type: String, required: true, trim: true, maxlength: 60 },
        expiryDate: { type: Date, required: true },
        quantityReceived: { type: Number, required: true, min: 0 },
        quantityRemaining: { type: Number, required: true, min: 0 },
        supplier: { type: String, trim: true, maxlength: 120 },
        receivedAt: { type: Date, default: Date.now },
        // QUARANTINE = physiquement en stock mais interdit à la vente.
        status: { type: String, enum: ["AVAILABLE", "QUARANTINE"], default: "AVAILABLE" },
        statusReason: { type: String, trim: true, maxlength: 200 }
    },
    { timestamps: true }
);

medicineLotSchema.index({ pharmacy: 1, medicine: 1, lotNumber: 1 }, { unique: true });
medicineLotSchema.index({ stock: 1, expiryDate: 1 });

module.exports = mongoose.model("MedicineLot", medicineLotSchema);
