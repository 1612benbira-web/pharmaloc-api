const Lot = require("../models/Lot");
const AppError = require("../utils/AppError");
const { classifyLot } = require("../domain/stockMath");
const { canAccessPharmacy } = require("../services/accessService");
const { pharmacyScope } = require("../services/scopeService");
const { sweepExpiredLots, quarantineLot, releaseLot } = require("../services/lotService");
const { idempotencyHeader } = require("../validators/stockValidators");

async function loadAccessibleLot(user, id) {
    const lot = await Lot.findById(id).select("pharmacy");
    if (!lot || !canAccessPharmacy(user, lot.pharmacy)) throw new AppError(404, "Lot introuvable", "LOT_NOT_FOUND");
}

const withClassification = (l) => ({ ...l, classification: classifyLot(l) });

const listLots = async (req, res) => {
    const { page, limit, stock, pharmacy, state } = req.valid.query;
    const pharmacies = pharmacyScope(req.user, pharmacy);
    await Promise.all(pharmacies.map((p) => sweepExpiredLots({ pharmacyId: p })));

    const filter = { pharmacy: { $in: pharmacies }, ...(stock ? { stock } : {}), ...(state ? { state } : {}) };
    const [lots, total] = await Promise.all([
        Lot.find(filter).populate("medicine", "name dosage form").sort({ expiryDate: 1 })
            .skip((page - 1) * limit).limit(limit).lean(),
        Lot.countDocuments(filter)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(lots.map(withClassification));
};

const quarantine = async (req, res) => {
    await loadAccessibleLot(req.user, req.valid.params.id);
    const lot = await quarantineLot({
        lotId: req.valid.params.id, reason: req.valid.body.reason, performedBy: req.user._id,
        idempotencyKey: idempotencyHeader.parse(req.get("Idempotency-Key"))
    });
    res.status(200).json({ message: "Lot mis en quarantaine : il n'est plus disponible à la vente", lot });
};

const release = async (req, res) => {
    await loadAccessibleLot(req.user, req.valid.params.id);
    const lot = await releaseLot({
        lotId: req.valid.params.id, reason: req.valid.body.reason, performedBy: req.user._id,
        idempotencyKey: idempotencyHeader.parse(req.get("Idempotency-Key"))
    });
    res.status(200).json({ message: "Lot remis en vente", lot });
};

module.exports = { listLots, quarantine, release };
