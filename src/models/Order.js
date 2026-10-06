const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
    {
        stock: { type: mongoose.Schema.Types.ObjectId, ref: "Stock", required: true },
        medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
        // Copie au moment de l'achat : l'historique ne change pas si le prix change ensuite.
        name: { type: String, required: true, trim: true },
        unitPrice: { type: Number, required: true, min: 0 },
        quantity: { type: Number, required: true, min: 1 }
    },
    { _id: false }
);

const orderSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },

        items: {
            type: [orderItemSchema],
            validate: { validator: (v) => v.length > 0, message: "Une commande doit contenir au moins un article" }
        },

        fulfillment: { type: String, enum: ["PICKUP", "DELIVERY"], required: true },
        deliveryAddress: { type: String, trim: true, maxlength: 300 },
        // Téléphone où joindre le client pour la livraison (livraison à domicile uniquement).
        contactPhone: { type: String, trim: true, maxlength: 20 },

        itemsTotal: { type: Number, required: true, min: 0 },
        deliveryFee: { type: Number, default: 0, min: 0 },
        total: { type: Number, required: true, min: 0 },
        currency: { type: String, default: "XOF" },

        status: {
            type: String,
            enum: ["PAYMENT_PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED", "EXPIRED"],
            default: "PAYMENT_PENDING"
        },

        // Motif d'une annulation faite par la pharmacie ou l'administration sur une commande déjà payée.
        cancellationReason: { type: String, trim: true, maxlength: 200 },

        // true une fois TOUTES les lignes réservées : une commande non réservée ne peut pas être payée.
        stockReserved: { type: Boolean, default: false },
        // Au-delà, une commande non payée expire et son stock est remis en vente.
        reservationExpiresAt: { type: Date, required: true },

        idempotencyKey: { type: String, trim: true }
    },
    { timestamps: true }
);

orderSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ pharmacy: 1, status: 1, createdAt: -1 });
orderSchema.index({ status: 1, reservationExpiresAt: 1 });

module.exports = mongoose.model("Order", orderSchema);
