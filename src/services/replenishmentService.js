const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const PurchaseOrder = require("../models/PurchaseOrder");
const { estimateFromTotals, suggestOrderQuantity } = require("../domain/replenishment");
const { ON_ORDER_STATUSES } = require("../domain/purchaseOrderFlow");
const { DAY_MS } = require("../domain/stockMath");

const DEFAULT_SAFETY_FACTOR = 0.2;
const DEMAND_WINDOW_DAYS = 30;

// Reste à recevoir par stock : somme de max(0, commandé - reçu) sur les commandes engagées.
async function loadOnOrder(pharmacyIds) {
    const rows = await PurchaseOrder.aggregate([
        { $match: { pharmacy: { $in: pharmacyIds }, status: { $in: ON_ORDER_STATUSES } } },
        { $unwind: "$lines" },
        { $group: { _id: "$lines.stock", qty: { $sum: { $max: [0, { $subtract: ["$lines.quantityOrdered", "$lines.quantityReceived"] }] } } } }
    ]);
    return new Map(rows.map((r) => [String(r._id), r.qty]));
}

// Ventes (type OUT appliquées) des 30 derniers jours, agrégées par stock. Pertes et péremptions exclues.
async function loadDemand(pharmacyIds, now = new Date()) {
    const since = new Date(now.getTime() - DEMAND_WINDOW_DAYS * DAY_MS);
    const rows = await StockMovement.aggregate([
        { $match: { pharmacy: { $in: pharmacyIds }, type: "OUT", status: "APPLIED", createdAt: { $gte: since } } },
        { $group: { _id: "$stock", total: { $sum: "$quantity" }, count: { $sum: 1 }, earliest: { $min: "$createdAt" } } }
    ]);
    return new Map(rows.map((r) => [String(r._id), estimateFromTotals(r, { now, windowDays: DEMAND_WINDOW_DAYS })]));
}

async function getSuggestions({ pharmacyIds, stockIds, safetyFactor = DEFAULT_SAFETY_FACTOR, includeAll = false, now = new Date() }) {
    const filter = { pharmacy: { $in: pharmacyIds } };
    if (stockIds) filter._id = { $in: stockIds };
    const stocks = await Stock.find(filter).populate("medicine", "name dosage form").lean();

    const [onOrder, demand] = await Promise.all([loadOnOrder(pharmacyIds), loadDemand(pharmacyIds, now)]);

    const items = stocks.map((s) => {
        const id = String(s._id);
        const d = demand.get(id) || { dailyDemand: null, confidence: "INSUFFICIENT", note: "Aucune vente sur la période." };
        const onOrderQuantity = onOrder.get(id) || 0;
        const suggestion = suggestOrderQuantity({
            targetQuantity: s.targetQuantity ?? null,
            availableQuantity: s.quantity, onOrderQuantity,
            minOrderQuantity: s.minOrderQuantity, packSize: s.packSize,
            dailyDemand: d.dailyDemand, leadTimeDays: s.leadTimeDays || 0,
            safetyStock: s.safetyStock || 0, safetyFactor
        });
        return {
            stock: s._id, pharmacy: s.pharmacy, medicine: s.medicine,
            available: s.quantity, onOrder: onOrderQuantity, suggestion,
            demand: { dailyDemand: d.dailyDemand, confidence: d.confidence, note: d.note },
            // Transparence : ce qui est estimé et ce qui manque.
            limits: suggestion.reason === "INSUFFICIENT_DATA"
                ? "Définissez un stock cible pour ce produit afin d'obtenir une suggestion."
                : (d.dailyDemand === null ? "Suggestion fondée sur le stock cible uniquement (historique de ventes insuffisant)." : undefined)
        };
    });

    return (includeAll ? items : items.filter((i) => i.suggestion.quantity > 0))
        .sort((a, b) => (a.available - b.available));
}

module.exports = { getSuggestions, loadOnOrder, loadDemand, DEFAULT_SAFETY_FACTOR };
