const Supplier = require("../models/Supplier");
const AppError = require("../utils/AppError");
const { assertPharmacyAccess, canAccessPharmacy } = require("../services/accessService");
const { pharmacyScope } = require("../services/scopeService");

const createSupplier = async (req, res) => {
    const { pharmacy, ...fields } = req.valid.body;
    assertPharmacyAccess(req.user, pharmacy);
    const supplier = await Supplier.create({ pharmacy, ...fields });
    res.status(201).json({ message: "Fournisseur créé", supplier });
};

const listSuppliers = async (req, res) => {
    const { page, limit, pharmacy } = req.valid.query;
    const filter = { pharmacy: { $in: pharmacyScope(req.user, pharmacy) } };
    const [suppliers, total] = await Promise.all([
        Supplier.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit),
        Supplier.countDocuments(filter)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(suppliers);
};

const updateSupplier = async (req, res) => {
    const existing = await Supplier.findById(req.valid.params.id).select("pharmacy");
    if (!existing || !canAccessPharmacy(req.user, existing.pharmacy)) {
        throw new AppError(404, "Fournisseur introuvable", "SUPPLIER_NOT_FOUND");
    }
    const supplier = await Supplier.findByIdAndUpdate(req.valid.params.id, req.valid.body, { returnDocument: "after", runValidators: true });
    res.status(200).json({ message: "Fournisseur modifié", supplier });
};

module.exports = { createSupplier, listSuppliers, updateSupplier };
