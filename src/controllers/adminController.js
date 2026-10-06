const Pharmacy = require("../models/Pharmacy");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const authService = require("../services/authService");
const audit = require("../services/auditService");
const { accentInsensitiveRegex } = require("../domain/catalogRules");
const { STAFF_ROLES } = require("../validators/adminValidators");

// Express 5 transmet automatiquement les erreurs async à errorHandler : pas de try/catch.

const userView = (u) => ({
    id: u._id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, createdAt: u.createdAt,
    pharmacies: (u.pharmacies || []).map((p) => (p && p.name !== undefined ? { id: p._id, name: p.name } : { id: p }))
});

// Création d'un compte du personnel (pharmacien, responsable, livreur, admin) par un administrateur.
const createStaffUser = async (req, res) => {
    const { name, email, password, role, pharmacies } = req.valid.body;

    if (role !== "admin" && pharmacies.length === 0) {
        throw new AppError(400, "Un pharmacien, un responsable ou un livreur doit être affecté à au moins une pharmacie", "PHARMACY_REQUIRED");
    }
    const found = await Pharmacy.countDocuments({ _id: { $in: pharmacies } });
    if (found !== new Set(pharmacies).size) {
        throw new AppError(404, "Une des pharmacies indiquées est introuvable", "PHARMACY_NOT_FOUND");
    }

    // Mot de passe provisoire : son titulaire devra le changer avant de pouvoir utiliser l'application.
    const user = await authService.createUser({ name, email, password, role, pharmacies, mustChangePassword: true });
    await audit.record({
        actor: req.user._id, action: "USER_CREATED", target: String(user._id),
        meta: { role, pharmacies }
    });

    res.status(201).json({
        message: "Compte créé",
        user: { id: user._id, name: user.name, email: user.email, role: user.role, pharmacies: user.pharmacies }
    });
};

const listUsers = async (req, res) => {
    const { q, role, page, limit } = req.valid.query;
    const re = q ? accentInsensitiveRegex(q) : null;
    const filter = { role: role || { $in: STAFF_ROLES }, ...(re ? { $or: [{ name: re }, { email: re }] } : {}) };
    const [users, total] = await Promise.all([
        User.find(filter).populate("pharmacies", "name").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        User.countDocuments(filter)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(users.map(userView));
};

// Suspendre ou réactiver un compte du personnel. Une suspension ferme aussitôt toutes ses sessions.
const setUserActive = async (req, res) => {
    const { id } = req.valid.params;
    const { isActive } = req.valid.body;
    if (String(id) === String(req.user._id) && !isActive) {
        throw new AppError(409, "Vous ne pouvez pas désactiver votre propre compte", "CANNOT_DEACTIVATE_SELF");
    }
    const user = await User.findOneAndUpdate({ _id: id, role: { $in: STAFF_ROLES } }, { isActive }, { returnDocument: "after" })
        .populate("pharmacies", "name").lean();
    if (!user) throw new AppError(404, "Compte introuvable", "USER_NOT_FOUND");
    if (!isActive) await authService.revokeAllSessions(user._id);
    res.status(200).json({
        message: isActive ? "Compte réactivé" : "Compte désactivé : ses sessions sont fermées",
        user: userView(user)
    });
};

module.exports = { createStaffUser, listUsers, setUserActive };
