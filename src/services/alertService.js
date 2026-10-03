const Alert = require("../models/Alert");
const Stock = require("../models/Stock");
const Lot = require("../models/Lot");
const StockMovement = require("../models/StockMovement");
const PurchaseOrder = require("../models/PurchaseOrder");
const { evaluateStockAlerts, evaluateAdjustmentAlerts, evaluateOrderAlerts } = require("../domain/alertRules");
const { DAY_MS } = require("../domain/stockMath");
const { sweepExpiredLots } = require("./lotService");
const { loadOnOrder, loadDemand } = require("./replenishmentService");

async function upsertAlert(pharmacyId, c, now) {
    return Alert.updateOne(
        { pharmacy: pharmacyId, dedupeKey: c.dedupeKey },
        {
            $set: { type: c.type, severity: c.severity, message: c.message, data: c.data, lastSeenAt: now },
            $setOnInsert: { status: "OPEN", firstSeenAt: now }
        },
        { upsert: true }
    );
}

// Synchronise : crée ou met à jour (jamais de doublon), rouvre ce qui réapparaît, résout ce qui a disparu.
async function syncAlerts(pharmacyId, candidates, now) {
    for (const c of candidates) {
        try {
            await upsertAlert(pharmacyId, c, now);
        } catch (err) {
            if (err && err.code === 11000) await upsertAlert(pharmacyId, c, now); // course entre deux évaluations
            else throw err;
        }
    }
    const keys = candidates.map((c) => c.dedupeKey);
    await Alert.updateMany({ pharmacy: pharmacyId, dedupeKey: { $in: keys }, status: "RESOLVED" },
        { status: "OPEN", $unset: { resolvedAt: 1 } });
    await Alert.updateMany({ pharmacy: pharmacyId, status: { $in: ["OPEN", "ACKNOWLEDGED"] }, dedupeKey: { $nin: keys } },
        { status: "RESOLVED", resolvedAt: now });
}

async function evaluatePharmacy(pharmacyId, now = new Date()) {
    await sweepExpiredLots({ pharmacyId, now });

    const [stocks, lots, onOrder, demand, adjustments, orders] = await Promise.all([
        Stock.find({ pharmacy: pharmacyId }).lean(),
        Lot.find({ pharmacy: pharmacyId, state: { $in: ["OK", "EXPIRED"] }, remainingQuantity: { $gt: 0 } }).lean(),
        loadOnOrder([pharmacyId]),
        loadDemand([pharmacyId], now),
        StockMovement.find({ pharmacy: pharmacyId, type: "ADJUSTMENT", status: "APPLIED", createdAt: { $gte: new Date(now - 7 * DAY_MS) } }).lean(),
        PurchaseOrder.find({ pharmacy: pharmacyId, status: { $in: ["PENDING_APPROVAL", "SENT", "PARTIALLY_RECEIVED"] } }).lean()
    ]);

    const lotsByStock = new Map();
    for (const l of lots) {
        const k = String(l.stock);
        if (!lotsByStock.has(k)) lotsByStock.set(k, []);
        lotsByStock.get(k).push(l);
    }

    const candidates = [
        ...stocks.flatMap((s) => evaluateStockAlerts({
            stock: s, lots: lotsByStock.get(String(s._id)) || [],
            onOrderQuantity: onOrder.get(String(s._id)) || 0,
            dailyDemand: demand.get(String(s._id))?.dailyDemand ?? null, now
        })),
        ...evaluateAdjustmentAlerts(adjustments),
        ...evaluateOrderAlerts(orders, now)
    ];

    await syncAlerts(pharmacyId, candidates, now);
    return Alert.find({ pharmacy: pharmacyId, status: { $in: ["OPEN", "ACKNOWLEDGED"] } })
        .sort({ severity: -1, lastSeenAt: -1 }).lean();
}

module.exports = { evaluatePharmacy, syncAlerts };
