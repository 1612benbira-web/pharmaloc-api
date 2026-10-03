const Medicine = require("../models/Medicine");
const Pharmacy = require("../models/Pharmacy");
const Stock = require("../models/Stock");
const Lot = require("../models/Lot");
const AppError = require("../utils/AppError");
const { sweepExpiredLots } = require("../services/lotService");
const { haversineKm, accentInsensitiveRegex, patientAvailability, STATUS_RANK } = require("../domain/catalogRules");

// Express 5 transmet automatiquement les erreurs async à errorHandler : pas de try/catch.

const MAX_CANDIDATES = 500;

// Champs publics uniquement : rien d'interne (sourceReference, dates...) ne sort.
const medicineView = (m) => ({
    id: m._id, name: m.name, genericName: m.genericName, activeIngredient: m.activeIngredient,
    laboratory: m.laboratory, dosage: m.dosage, form: m.form, packaging: m.packaging,
    prescriptionRequired: m.prescriptionRequired
});

const pharmacyView = (p) => ({
    id: p._id, name: p.name, address: p.address, city: p.city, phone: p.phone,
    openingHours: p.openingHours, latitude: p.latitude, longitude: p.longitude,
    publishesAvailability: Boolean(p.publishAvailability)
});

const distanceOf = (pharmacy, geo) =>
    geo && typeof pharmacy.latitude === "number" && typeof pharmacy.longitude === "number"
        ? Math.round(haversineKm(geo.lat, geo.lng, pharmacy.latitude, pharmacy.longitude) * 10) / 10
        : undefined;

// Plus proche d'abord ; sans position connue, en dernier.
const byDistance = (a, b) => {
    if (a.distanceKm === undefined && b.distanceKm === undefined) return 0;
    if (a.distanceKm === undefined) return 1;
    if (b.distanceKm === undefined) return -1;
    return a.distanceKm - b.distanceKm;
};

const page_ = (rows, page, limit) => rows.slice((page - 1) * limit, page * limit);

const searchMedicines = async (req, res) => {
    const { q, page, limit } = req.valid.query;
    const re = accentInsensitiveRegex(q);
    const scope = {
        isActive: { $ne: false },
        $or: [{ name: re }, { genericName: re }, { activeIngredient: re }]
    };
    const [medicines, total] = await Promise.all([
        Medicine.find(scope).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        Medicine.countDocuments(scope)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(medicines.map(medicineView));
};

const getAvailability = async (req, res) => {
    const { city, lat, lng, radiusKm, includeOutOfStock, page, limit } = req.valid.query;
    const medicine = await Medicine.findOne({ _id: req.valid.params.id, isActive: { $ne: false } }).lean();
    if (!medicine) throw new AppError(404, "Médicament introuvable", "MEDICINE_NOT_FOUND");

    const now = new Date();
    const geo = lat !== undefined ? { lat, lng } : null;

    // Seules les pharmacies actives qui ACCEPTENT de publier leur disponibilité sont visibles.
    const stocks = await Stock.find({ medicine: medicine._id }).limit(MAX_CANDIDATES * 2).lean();
    const pharmacies = await Pharmacy.find({
        _id: { $in: stocks.map((s) => s.pharmacy) },
        isActive: true,
        publishAvailability: true,
        ...(city ? { city: accentInsensitiveRegex(city, { exact: true }) } : {})
    }).lean();
    const byId = new Map(pharmacies.map((p) => [String(p._id), p]));
    let visible = stocks.filter((s) => byId.has(String(s.pharmacy)));

    // Un lot périmé ne doit jamais être annoncé comme disponible : on constate les péremptions
    // (idempotent, comme pour les alertes) uniquement pour les stocks affichés.
    const toSweep = await Lot.distinct("stock", {
        stock: { $in: visible.map((s) => s._id) }, state: "OK", expiryDate: { $lte: now }, remainingQuantity: { $gt: 0 }
    });
    if (toSweep.length) {
        for (const stockId of toSweep) await sweepExpiredLots({ stockId, now });
        const refreshed = new Map((await Stock.find({ _id: { $in: toSweep } }).lean()).map((s) => [String(s._id), s]));
        visible = visible.map((s) => refreshed.get(String(s._id)) || s);
    }

    let rows = [];
    for (const stock of visible) {
        const pharmacy = byId.get(String(stock.pharmacy));
        const distanceKm = distanceOf(pharmacy, geo);
        if (radiusKm !== undefined && (distanceKm === undefined || distanceKm > radiusKm)) continue;

        const view = patientAvailability({ stock, pharmacy, medicine, now });
        if (view.status === "OUT_OF_STOCK" && !includeOutOfStock) continue;

        rows.push({ pharmacy: pharmacyView(pharmacy), ...(distanceKm !== undefined ? { distanceKm } : {}), ...view });
    }

    rows.sort(geo
        ? byDistance
        : (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.pharmacy.name.localeCompare(b.pharmacy.name));

    res.set("X-Total-Count", String(rows.length));
    res.status(200).json({ medicine: medicineView(medicine), generatedAt: now, results: page_(rows, page, limit) });
};

const searchPharmacies = async (req, res) => {
    const { q, city, lat, lng, radiusKm, page, limit } = req.valid.query;
    const geo = lat !== undefined ? { lat, lng } : null;

    const pharmacies = await Pharmacy.find({
        isActive: true,
        ...(q ? { name: accentInsensitiveRegex(q) } : {}),
        ...(city ? { city: accentInsensitiveRegex(city, { exact: true }) } : {})
    }).sort({ name: 1 }).limit(MAX_CANDIDATES).lean();

    let rows = [];
    for (const p of pharmacies) {
        const distanceKm = distanceOf(p, geo);
        if (radiusKm !== undefined && (distanceKm === undefined || distanceKm > radiusKm)) continue;
        rows.push({ ...pharmacyView(p), ...(distanceKm !== undefined ? { distanceKm } : {}) });
    }
    if (geo) rows.sort(byDistance);

    res.set("X-Total-Count", String(rows.length));
    res.status(200).json(page_(rows, page, limit));
};

module.exports = { searchMedicines, getAvailability, searchPharmacies };