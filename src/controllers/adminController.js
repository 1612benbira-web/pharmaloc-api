const Pharmacy = require("../models/Pharmacy");
const AppError = require("../utils/AppError");
const authService = require("../services/authService");
const audit = require("../services/auditService");

// Création d'un compte du personnel (pharmacien, responsable, admin) par un administrateur.
const createStaffUser = async (req, res) => {
    const { name, email, password, role, pharmacies } = req.valid.body;

    if (role !== "admin" && pharmacies.length === 0) {
        throw new AppError(400, "Un pharmacien ou responsable doit être affecté à au moins une pharmacie", "PHARMACY_REQUIRED");
    }
    const found = await Pharmacy.countDocuments({ _id: { $in: pharmacies } });
    if (found !== new Set(pharmacies).size) {
        throw new AppError(404, "Une des pharmacies indiquées est introuvable", "PHARMACY_NOT_FOUND");
    }

    const user = await authService.createUser({ name, email, password, role, pharmacies });
    await audit.record({
        actor: req.user._id, action: "USER_CREATED", target: String(user._id),
        meta: { role, pharmacies }
    });

    res.status(201).json({
        message: "Compte créé",
        user: { id: user._id, name: user.name, email: user.email, role: user.role, pharmacies: user.pharmacies }
    });
};

module.exports = { createStaffUser };
