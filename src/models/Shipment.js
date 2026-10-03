const mongoose = require("mongoose");

// Une "course" : le trajet d'une commande de livraison, de la pharmacie à la porte du client.
// (Ne pas confondre avec `Delivery`, qui est la réception de marchandise d'un fournisseur.)
const shipmentSchema = new mongoose.Schema(
    {
        order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
        pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },
        courier: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

        // Copies prises à la création : le livreur ne lit jamais la commande (prix, paiement).
        address: { type: String, required: true, trim: true },
        contactPhone: { type: String, trim: true },
        items: [{ _id: false, name: { type: String, required: true }, quantity: { type: Number, required: true, min: 1 } }],

        status: { type: String, enum: ["PENDING", "ASSIGNED", "PICKED_UP", "DELIVERED", "FAILED"], default: "PENDING" },
        // true tant que la course n'est ni livrée ni échouée. Un index unique partiel garantit
        // UNE SEULE course ouverte par commande, même si deux requêtes arrivent en même temps.
        isOpen: { type: Boolean, default: true },
        attempt: { type: Number, default: 1, min: 1 },

        // Code de remise : lu uniquement par le patient (jamais par le livreur ni la pharmacie).
        deliveryCode: { type: String, required: true, select: false },
        codeAttempts: { type: Number, default: 0, min: 0 },

        assignedAt: { type: Date },
        pickedUpAt: { type: Date },
        deliveredAt: { type: Date },
        failedAt: { type: Date },
        failureReason: { type: String, trim: true, maxlength: 200 }
    },
    { timestamps: true }
);

shipmentSchema.index({ order: 1 }, { unique: true, partialFilterExpression: { isOpen: true } });
shipmentSchema.index({ pharmacy: 1, status: 1, createdAt: -1 });
shipmentSchema.index({ courier: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Shipment", shipmentSchema);