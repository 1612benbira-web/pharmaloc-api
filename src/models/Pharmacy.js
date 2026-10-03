const mongoose = require("mongoose");

const pharmacySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        address: {
            type: String,
            required: true,
            trim: true
        },

        city: {
            type: String,
            required: true,
            trim: true
        },

        phone: {
            type: String,
            required: true,
            trim: true
        },

        email: {
            type: String,
            trim: true,
            lowercase: true
        },

        latitude: {
            type: Number
        },

        longitude: {
            type: Number
        },

        openingHours: { type: String, trim: true, maxlength: 300 },

        // [v2] Les patients ne voient la disponibilité que si la pharmacie l'autorise.
        publishAvailability: { type: Boolean, default: false },
        // Les quantités exactes restent privées sauf autorisation explicite.
        publishQuantities: { type: Boolean, default: false },

        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

const Pharmacy = mongoose.model("Pharmacy", pharmacySchema);

module.exports = Pharmacy;