const mongoose = require("mongoose");

// [NOUVEAU v2] Une commande n'augmente JAMAIS le stock : seul un mouvement IN de réception le fait.
// DRAFT -> SUBMITTED (approuvée) -> PARTIALLY_RECEIVED -> RECEIVED ; CANCELLED possible tant que rien n'est reçu.
const purchaseOrderSchema = new mongoose.Schema(
    {
        pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },
        supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
        status: {
            type: String,
            enum: ["DRAFT", "SUBMITTED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
            default: "DRAFT"
        },
        lines: [{
            _id: false,
            medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
            quantity: { type: Number, required: true, min: 1 },
            // Recalculé à partir des mouvements de réception validés (jamais saisi à la main).
            receivedQuantity: { type: Number, default: 0, min: 0 },
            unitPrice: { type: Number, min: 0 }
        }],
        expectedDate: { type: Date },
        notes: { type: String, trim: true, maxlength: 500 },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        submittedAt: { type: Date },
        cancelReason: { type: String, trim: true, maxlength: 300 },
        generatedBy: { type: String, enum: ["MANUAL", "REPLENISHMENT"], default: "MANUAL" }
    },
    { timestamps: true }
);

purchaseOrderSchema.index({ pharmacy: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("PurchaseOrder", purchaseOrderSchema);
