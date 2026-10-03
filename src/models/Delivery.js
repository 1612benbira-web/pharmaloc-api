const mongoose = require("mongoose");

// [MODIFIÉ v2] Ajouts : status, idempotencyKey. Le workflow complet
// (brouillon, à vérifier, réception partielle...) viendra en Phase 3.
const deliverySchema = new mongoose.Schema(
    {
        pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },
        medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
        quantity: { type: Number, required: true, min: 1 },
        supplier: { type: String, trim: true },
        reference: { type: String, trim: true },
        deliveryDate: { type: Date, default: Date.now },

        // [v2] Lot reçu (facultatif : sans lot, les unités rejoignent le stock "sans lot").
        lotNumber: { type: String, trim: true, maxlength: 60 },
        expiryDate: { type: Date },
        unitPrice: { type: Number, min: 0 },
        // Commande fournisseur rattachée (facultatif).
        purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder" },

        // RECEIVED = stock mis à jour ; FAILED = enregistrée mais non appliquée au stock.
        status: { type: String, enum: ["RECEIVED", "FAILED"], default: "RECEIVED" },

        idempotencyKey: { type: String, trim: true }
    },
    { timestamps: true }
);

deliverySchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Delivery", deliverySchema);
