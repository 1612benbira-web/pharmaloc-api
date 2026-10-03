const mongoose = require("mongoose");

const stockSchema = new mongoose.Schema(
    {
        pharmacy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Pharmacy",
            required: true
        },

        medicine: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Medicine",
            required: true
        },

        quantity: {
            type: Number,
            required: true,
            min: 0,
            default: 0
        },

        // Prix de vente en FCFA dans cette pharmacie
        price: {
            type: Number,
            min: 0
        },

        minimumQuantity: {
            type: Number,
            min: 0,
            default: 10
        },

        // [v2] Paramètres de réapprovisionnement (tous optionnels)
        // `quantity` = stock DISPONIBLE à la vente (hors lots périmés ou en quarantaine).
        targetQuantity: { type: Number, min: 0 },
        leadTimeDays: { type: Number, min: 0 },
        safetyStock: { type: Number, min: 0, default: 0 },
        minOrderQuantity: { type: Number, min: 1, default: 1 },
        packSize: { type: Number, min: 1, default: 1 }
    },
    {
        timestamps: true
    }
);

stockSchema.index(
    { pharmacy: 1, medicine: 1 },
    { unique: true }
);

const Stock = mongoose.model("Stock", stockSchema);

module.exports = Stock;