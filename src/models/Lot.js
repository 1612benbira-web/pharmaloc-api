const mongoose = require("mongoose");

// [NOUVEAU v2] Lot d'un stock. `state` ne contient PAS "proche de péremption" (valeur calculée).
//  OK          : vendable tant que non périmé
//  QUARANTINE  : retiré du stock disponible, interdit à la vente
//  EXPIRED     : péremption constatée, retiré du stock disponible ; les unités restent à détruire/retourner
const lotSchema = new mongoose.Schema(
    {
        stock: { type: mongoose.Schema.Types.ObjectId, ref: "Stock", required: true },
        pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },
        medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
        lotNumber: { type: String, required: true, trim: true, maxlength: 60 },
        expiryDate: { type: Date, required: true },
        receivedQuantity: { type: Number, required: true, min: 0 },
        remainingQuantity: { type: Number, required: true, min: 0 },
        supplier: { type: String, trim: true, maxlength: 120 },
        receivedAt: { type: Date, default: Date.now },
        state: { type: String, enum: ["OK", "QUARANTINE", "EXPIRED"], default: "OK" },
        stateReason: { type: String, trim: true, maxlength: 300 },
        stateChangedAt: { type: Date },
        // Levé quand une péremption n'a pas pu être déduite du stock (incohérence à examiner).
        needsReview: { type: Boolean, default: false }
    },
    { timestamps: true }
);

lotSchema.index({ stock: 1, lotNumber: 1, expiryDate: 1 }, { unique: true });
lotSchema.index({ stock: 1, state: 1, expiryDate: 1 });
lotSchema.index({ pharmacy: 1, state: 1, expiryDate: 1 });

module.exports = mongoose.model("Lot", lotSchema);
