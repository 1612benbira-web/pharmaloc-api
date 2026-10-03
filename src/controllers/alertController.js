const Alert = require("../models/Alert");
const AppError = require("../utils/AppError");
const { assertPharmacyAccess, canAccessPharmacy } = require("../services/accessService");
const { pharmacyScope } = require("../services/scopeService");
const { evaluatePharmacy } = require("../services/alertService");

const evaluate = async (req, res) => {
    assertPharmacyAccess(req.user, req.valid.body.pharmacy);
    const alerts = await evaluatePharmacy(req.valid.body.pharmacy);
    res.status(200).json({ evaluatedAt: new Date(), count: alerts.length, alerts });
};

const listAlerts = async (req, res) => {
    const { page, limit, pharmacy, status } = req.valid.query;
    const filter = { pharmacy: { $in: pharmacyScope(req.user, pharmacy) }, status: status || { $in: ["OPEN", "ACKNOWLEDGED"] } };
    const [alerts, total] = await Promise.all([
        Alert.find(filter).sort({ severity: -1, lastSeenAt: -1 }).skip((page - 1) * limit).limit(limit),
        Alert.countDocuments(filter)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(alerts);
};

const acknowledge = async (req, res) => {
    const existing = await Alert.findById(req.valid.params.id).select("pharmacy");
    if (!existing || !canAccessPharmacy(req.user, existing.pharmacy)) throw new AppError(404, "Alerte introuvable", "ALERT_NOT_FOUND");
    const alert = await Alert.findOneAndUpdate(
        { _id: req.valid.params.id, status: "OPEN" },
        { status: "ACKNOWLEDGED", acknowledgedBy: req.user._id }, { returnDocument: "after" }
    );
    if (!alert) throw new AppError(409, "Cette alerte n'est plus ouverte", "ALERT_NOT_OPEN");
    res.status(200).json({ message: "Alerte prise en compte", alert });
};

module.exports = { evaluate, listAlerts, acknowledge };
