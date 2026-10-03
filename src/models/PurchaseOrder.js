const mongoose = require("mongoose");

// [NOUVEAU v2] Une commande n'augmente JAMAIS le stock : seule une livraison réceptionnée le fait.
// Workflow : voir src/domain/purchaseOrderFlow.js
const purchaseOrderSchema = new mongoose.Schema(
    {
        pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },
        supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
        status: {
            type: String,
            enum: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
            default: "DRAFT"
        },
        lines: {
            type: [{
                _id: false,
                stock: { type: mongoose.Schema.Types.ObjectId, ref: "Stock", required: true },
                medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
                quantityOrdered: { type: Number, required: true, min: 1 },
                // Incrémenté uniquement par les réceptions validées, jamais saisi à la main.
                quantityReceived: { type: Number, default: 0, min: 0 },
                unitPrice: { type: Number, min: 0 }
            }],
            validate: [(v) => v.length > 0, "Une commande doit contenir au moins une ligne"]
        },
        expectedDate: { type: Date },
        notes: { type: String, trim: true, maxlength: 500 },
        source: { type: String, enum: ["MANUAL", "REPLENISHMENT"], default: "MANUAL" },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approvedAt: { type: Date },
        sentAt: { type: Date },
        cancelReason: { type: String, trim: true, maxlength: 300 }
    },
    { timestamps: true }
);

purchaseOrderSchema.index({ pharmacy: 1, status: 1, createdAt: -1 });
purchaseOrderSchema.index({ "lines.stock": 1, status: 1 });

module.exports = mongoose.model("PurchaseOrder", purchaseOrderSchema);
