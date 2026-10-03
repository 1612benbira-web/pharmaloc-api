const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
    {
        order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

        // Le montant vient toujours de la commande, jamais du client.
        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, default: "XOF" },

        method: { type: String, enum: ["WAVE", "ORANGE_MONEY", "FREE_MONEY", "CARD"], required: true },
        status: { type: String, enum: ["PENDING", "PROCESSING", "PAID", "FAILED", "REFUNDED"], default: "PENDING" },

        // true tant que le paiement est en cours ou réglé. Un index unique partiel garantit
        // UN SEUL paiement ouvert par commande, même si deux requêtes arrivent en même temps.
        isOpen: { type: Boolean, default: true },

        // Référence du prestataire. On ne stocke JAMAIS de numéro de carte, de CVV ni de code secret.
        transactionId: { type: String, trim: true },
        paidAt: { type: Date },

        // Paiement reçu alors que la commande n'était plus payable (expirée, annulée) : remboursement à traiter.
        needsReview: { type: Boolean, default: false },

        idempotencyKey: { type: String, trim: true }
    },
    { timestamps: true }
);

paymentSchema.index({ order: 1 }, { unique: true, partialFilterExpression: { isOpen: true } });
paymentSchema.index({ transactionId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
paymentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);