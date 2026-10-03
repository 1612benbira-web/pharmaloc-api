const mongoose = require("mongoose");

const TYPES = ["IN", "OUT", "ADJUSTMENT", "RETURN", "LOSS", "BREAKAGE", "EXPIRY", "QUARANTINE", "RELEASE"];

// [MODIFIÉ v2] idempotencyKey, status, performedBy, delta signé, lots touchés, pharmacie/médicament dénormalisés.
// Les anciens documents (sans ces champs) restent lisibles : status vaut APPLIED par défaut.
const stockMovementSchema = new mongoose.Schema(
    {
        stock: { type: mongoose.Schema.Types.ObjectId, ref: "Stock", required: true },
        pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" },
        medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine" },

        type: { type: String, enum: TYPES, required: true },

        // Quantité toujours positive ; le sens est porté par `delta` (signé).
        quantity: { type: Number, required: true, min: 1 },
        delta: { type: Number },

        stockBefore: { type: Number, min: 0, required: function () { return this.status === "APPLIED"; } },
        stockAfter: { type: Number, min: 0, required: function () { return this.status === "APPLIED"; } },

        reason: { type: String, trim: true },
        delivery: { type: mongoose.Schema.Types.ObjectId, ref: "Delivery" },

        // Lots touchés (une vente FEFO peut en toucher plusieurs).
        allocations: [{
            _id: false,
            lot: { type: mongoose.Schema.Types.ObjectId, ref: "Lot" },
            quantity: { type: Number, min: 1 }
        }],

        // PENDING = réservé, pas encore appliqué ; REJECTED = refusé (trace conservée).
        status: { type: String, enum: ["PENDING", "APPLIED", "REJECTED"], default: "APPLIED" },
        rejectionReason: { type: String, trim: true },
        idempotencyKey: { type: String, trim: true },
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    { timestamps: true }
);

stockMovementSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
stockMovementSchema.index({ stock: 1, createdAt: -1 });
stockMovementSchema.index({ pharmacy: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("StockMovement", stockMovementSchema);
module.exports.TYPES = TYPES;
