const Medicine = require("../models/Medicine");
const Stock = require("../models/Stock");
const Order = require("../models/Order");
const Delivery = require("../models/Delivery");
const AppError = require("../utils/AppError");
const { accentInsensitiveRegex } = require("../domain/catalogRules");

// Express 5 transmet automatiquement les erreurs async à errorHandler : pas de try/catch.

// Ces rôles voient aussi les médicaments inactifs (propositions en attente de validation).
const SEES_INACTIVE = ["admin", "pharmacist", "pharmacy_manager"];
// Champs que seul un administrateur peut définir.
const ADMIN_ONLY = ["sourceReference", "prescriptionRequired", "isActive"];

const PUBLIC_FIELDS = ["name", "genericName", "activeIngredient", "laboratory", "category", "dosage", "form", "packaging", "prescriptionRequired"];

// Vue selon le rôle : champs publics pour tous, statut pour le personnel, provenance pour l'admin.
function medicineView(m, role) {
    const out = { _id: m._id };
    for (const k of PUBLIC_FIELDS) if (m[k] !== undefined) out[k] = m[k];
    if (SEES_INACTIVE.includes(role)) out.isActive = m.isActive !== false;
    if (role === "admin") {
        if (m.sourceReference !== undefined) out.sourceReference = m.sourceReference;
        out.createdAt = m.createdAt;
        out.updatedAt = m.updatedAt;
    }
    return out;
}

const visibleTo = (user) => (SEES_INACTIVE.includes(user.role) ? {} : { isActive: { $ne: false } });

const listMedicines = async (req, res) => {
    const { q, page, limit } = req.valid.query;
    const re = q ? accentInsensitiveRegex(q) : null;
    const scope = {
        ...visibleTo(req.user),
        ...(re ? { $or: [{ name: re }, { genericName: re }, { activeIngredient: re }] } : {})
    };
    const [medicines, total] = await Promise.all([
        Medicine.find(scope).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        Medicine.countDocuments(scope)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(medicines.map((m) => medicineView(m, req.user.role)));
};

const getMedicine = async (req, res) => {
    const medicine = await Medicine.findOne({ _id: req.valid.params.id, ...visibleTo(req.user) }).lean();
    if (!medicine) throw new AppError(404, "Médicament introuvable", "MEDICINE_NOT_FOUND");
    res.status(200).json(medicineView(medicine, req.user.role));
};

const createMedicine = async (req, res) => {
    const body = req.valid.body;
    const isAdmin = req.user.role === "admin";

    if (!isAdmin) {
        const forbidden = ADMIN_ONLY.filter((k) => body[k] !== undefined);
        if (forbidden.length) {
            throw new AppError(403, `Seul un administrateur peut définir : ${forbidden.join(", ")}`, "ADMIN_ONLY_FIELD", { fields: forbidden });
        }
    }

    // Un médicament proposé par un responsable reste invisible ET soumis à ordonnance
    // tant qu'un administrateur ne l'a pas validé : le catalogue est commun à toutes les pharmacies.
    const doc = isAdmin ? body : { ...body, isActive: false, prescriptionRequired: true };
    const medicine = await Medicine.create(doc);

    res.status(201).json({
        message: isAdmin ? "Médicament créé avec succès" : "Médicament proposé : il sera visible et commandable après validation par un administrateur",
        medicine: medicineView(medicine.toObject(), req.user.role)
    });
};

const updateMedicine = async (req, res) => {
    const medicine = await Medicine.findByIdAndUpdate(req.valid.params.id, req.valid.body, { returnDocument: "after", runValidators: true }).lean();
    if (!medicine) throw new AppError(404, "Médicament introuvable", "MEDICINE_NOT_FOUND");
    res.status(200).json({ message: "Médicament modifié avec succès", medicine: medicineView(medicine, req.user.role) });
};

const deleteMedicine = async (req, res) => {
    const id = req.valid.params.id;
    if (!(await Medicine.exists({ _id: id }))) throw new AppError(404, "Médicament introuvable", "MEDICINE_NOT_FOUND");

    const used = (await Stock.exists({ medicine: id })) || (await Order.exists({ "items.medicine": id })) || (await Delivery.exists({ medicine: id }));
    if (used) {
        throw new AppError(409, "Ce médicament est utilisé (stocks, commandes ou livraisons) : désactivez-le (isActive: false) au lieu de le supprimer", "MEDICINE_IN_USE");
    }
    await Medicine.deleteOne({ _id: id });
    res.status(200).json({ message: "Médicament supprimé avec succès" });
};

module.exports = { listMedicines, getMedicine, createMedicine, updateMedicine, deleteMedicine };