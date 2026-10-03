const Pharmacy = require("../models/Pharmacy");
const Stock = require("../models/Stock");
const Order = require("../models/Order");
const Delivery = require("../models/Delivery");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const { canAccessPharmacy } = require("../services/accessService");
const { accentInsensitiveRegex } = require("../domain/catalogRules");

// Express 5 transmet automatiquement les erreurs async à errorHandler : pas de try/catch.

const isAdmin = (user) => user.role === "admin";

// Fiche complète : admin, ou personnel affecté à CETTE pharmacie. Les autres voient la fiche publique.
const seesFull = (user, pharmacy) => isAdmin(user) || canAccessPharmacy(user, pharmacy._id);

const fullView = (p) => ({
    _id: p._id, name: p.name, address: p.address, city: p.city, phone: p.phone, email: p.email,
    latitude: p.latitude, longitude: p.longitude, openingHours: p.openingHours,
    publishAvailability: p.publishAvailability, publishQuantities: p.publishQuantities,
    isActive: p.isActive, createdAt: p.createdAt, updatedAt: p.updatedAt
});

const publicView = (p) => ({
    _id: p._id, name: p.name, address: p.address, city: p.city, phone: p.phone,
    latitude: p.latitude, longitude: p.longitude, openingHours: p.openingHours,
    publishesAvailability: Boolean(p.publishAvailability)
});

const viewFor = (user, p) => (seesFull(user, p) ? fullView(p) : publicView(p));

// Pharmacies actives pour tout le monde ; l'admin voit tout, le personnel voit aussi ses propres pharmacies inactives.
const visibleTo = (user) =>
    isAdmin(user) ? {} : { $or: [{ isActive: true }, { _id: { $in: user.pharmacies || [] } }] };

const createPharmacy = async (req, res) => {
    const pharmacy = await Pharmacy.create(req.valid.body);
    res.status(201).json({ message: "Pharmacie créée avec succès", pharmacy: fullView(pharmacy.toObject()) });
};

const getPharmacies = async (req, res) => {
    const { q, city, page, limit } = req.valid.query;
    const filter = {
        $and: [
            visibleTo(req.user),
            ...(q ? [{ name: accentInsensitiveRegex(q) }] : []),
            ...(city ? [{ city: accentInsensitiveRegex(city, { exact: true }) }] : [])
        ]
    };
    const [pharmacies, total] = await Promise.all([
        Pharmacy.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        Pharmacy.countDocuments(filter)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(pharmacies.map((p) => viewFor(req.user, p)));
};

const getPharmacyById = async (req, res) => {
    const pharmacy = await Pharmacy.findOne({ $and: [{ _id: req.valid.params.id }, visibleTo(req.user)] }).lean();
    if (!pharmacy) throw new AppError(404, "Pharmacie introuvable", "PHARMACY_NOT_FOUND");
    res.status(200).json(viewFor(req.user, pharmacy));
};

const updatePharmacy = async (req, res) => {
    const id = req.valid.params.id;
    // Un responsable ne peut modifier que les pharmacies auxquelles il est affecté (contrôle AVANT toute requête).
    if (!isAdmin(req.user) && !canAccessPharmacy(req.user, id)) {
        throw new AppError(403, "Vous n'avez pas accès à cette pharmacie", "FORBIDDEN_PHARMACY");
    }
    // Suspendre ou réactiver une pharmacie est un pouvoir de l'administrateur.
    if (!isAdmin(req.user) && req.valid.body.isActive !== undefined) {
        throw new AppError(403, "Seul un administrateur peut activer ou désactiver une pharmacie", "ADMIN_ONLY_FIELD", { fields: ["isActive"] });
    }
    const pharmacy = await Pharmacy.findByIdAndUpdate(id, req.valid.body, { returnDocument: "after", runValidators: true }).lean();
    if (!pharmacy) throw new AppError(404, "Pharmacie introuvable", "PHARMACY_NOT_FOUND");
    res.status(200).json({ message: "Pharmacie modifiée avec succès", pharmacy: fullView(pharmacy) });
};

const deletePharmacy = async (req, res) => {
    const id = req.valid.params.id;
    if (!(await Pharmacy.exists({ _id: id }))) throw new AppError(404, "Pharmacie introuvable", "PHARMACY_NOT_FOUND");

    const used =
        (await Stock.exists({ pharmacy: id })) || (await Order.exists({ pharmacy: id })) ||
        (await Delivery.exists({ pharmacy: id })) || (await User.exists({ pharmacies: id }));
    if (used) {
        throw new AppError(409, "Cette pharmacie est utilisée (stocks, commandes, livraisons ou personnel) : désactivez-la (isActive: false) au lieu de la supprimer", "PHARMACY_IN_USE");
    }
    await Pharmacy.deleteOne({ _id: id });
    res.status(200).json({ message: "Pharmacie supprimée avec succès" });
};

module.exports = { createPharmacy, getPharmacies, getPharmacyById, updatePharmacy, deletePharmacy };