// Règles d'alerte PURES. Chaque alerte a une clé de déduplication stable :
// le même incident ne produit jamais deux alertes.
const { classifyLot, isLowStock } = require("./stockMath");

const SEVERITY = { CRITICAL: "CRITICAL", WARNING: "WARNING", INFO: "INFO" };

function evaluateStockAlerts({ stock, lots = [], onOrderQuantity = 0, dailyDemand = null, now = new Date(), nearDays = 30 }) {
    const id = String(stock._id);
    const out = [];

    if (stock.quantity <= 0) {
        out.push({ type: "OUT_OF_STOCK", severity: SEVERITY.CRITICAL, dedupeKey: `OUT_OF_STOCK:${id}`,
            message: "Rupture de stock.", data: { stock: id } });
    } else if (isLowStock(stock)) {
        out.push({ type: "LOW_STOCK", severity: SEVERITY.WARNING, dedupeKey: `LOW_STOCK:${id}`,
            message: `Stock (${stock.quantity}) sous le seuil minimum (${stock.minimumQuantity}).`,
            data: { stock: id, quantity: stock.quantity, minimumQuantity: stock.minimumQuantity } });
    }

    // Rupture probable : seulement si une demande fiable est connue et qu'aucune commande n'est en route.
    if (stock.quantity > 0 && dailyDemand > 0 && stock.leadTimeDays > 0 && onOrderQuantity === 0) {
        const daysOfCover = stock.quantity / dailyDemand;
        if (daysOfCover < stock.leadTimeDays) {
            out.push({ type: "STOCKOUT_RISK", severity: SEVERITY.WARNING, dedupeKey: `STOCKOUT_RISK:${id}`,
                message: `Rupture probable dans ~${Math.floor(daysOfCover)} jour(s), délai de livraison ${stock.leadTimeDays} jour(s).`,
                data: { stock: id, daysOfCover: Number(daysOfCover.toFixed(1)), leadTimeDays: stock.leadTimeDays } });
        }
    }

    for (const lot of lots) {
        if (lot.remainingQuantity <= 0) continue;
        const cls = classifyLot(lot, now, nearDays);
        const base = { lot: String(lot._id), lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, remaining: lot.remainingQuantity };
        if (cls === "EXPIRED") {
            out.push({ type: "LOT_EXPIRED", severity: SEVERITY.CRITICAL, dedupeKey: `LOT_EXPIRED:${lot._id}`,
                message: `Lot ${lot.lotNumber} périmé (${lot.remainingQuantity} unité(s) à retirer).`, data: base });
        } else if (cls === "NEAR_EXPIRY") {
            out.push({ type: "LOT_NEAR_EXPIRY", severity: SEVERITY.WARNING, dedupeKey: `LOT_NEAR_EXPIRY:${lot._id}`,
                message: `Lot ${lot.lotNumber} proche de la péremption.`, data: base });
        }
    }

    // Écart d'inventaire : les unités des lots actifs dépassent le stock disponible => comptabilité incohérente.
    const okLotsTotal = lots.filter((l) => l.state === "OK").reduce((s, l) => s + l.remainingQuantity, 0);
    if (okLotsTotal > stock.quantity) {
        out.push({ type: "INVENTORY_DISCREPANCY", severity: SEVERITY.CRITICAL, dedupeKey: `INVARIANT:${id}`,
            message: `Écart à examiner : les lots actifs (${okLotsTotal}) dépassent le stock disponible (${stock.quantity}).`,
            data: { stock: id, lotsTotal: okLotsTotal, quantity: stock.quantity } });
    }
    return out;
}

// Gros ajustement négatif récent => à examiner (seuil : max(5 unités, 10 % du stock avant)).
function evaluateAdjustmentAlerts(movements) {
    return movements
        .filter((m) => m.type === "ADJUSTMENT" && m.delta < 0 && m.status === "APPLIED")
        .filter((m) => Math.abs(m.delta) >= Math.max(5, Math.ceil(0.1 * m.stockBefore)))
        .map((m) => ({
            type: "INVENTORY_DISCREPANCY", severity: SEVERITY.WARNING, dedupeKey: `ADJUSTMENT:${m._id}`,
            message: `Correction d'inventaire importante (${m.delta}) : justification à examiner.`,
            data: { movement: String(m._id), delta: m.delta, reason: m.reason }
        }));
}

function evaluateOrderAlerts(orders, now = new Date()) {
    const out = [];
    for (const o of orders) {
        const id = String(o._id);
        if (o.status === "PENDING_APPROVAL") {
            out.push({ type: "ORDER_PENDING_APPROVAL", severity: SEVERITY.INFO, dedupeKey: `PO_PENDING:${id}`,
                message: "Une commande attend une validation.", data: { order: id } });
        }
        if (["SENT", "PARTIALLY_RECEIVED"].includes(o.status) && o.expectedDate && new Date(o.expectedDate) < now) {
            out.push({ type: "DELIVERY_LATE", severity: SEVERITY.WARNING, dedupeKey: `PO_LATE:${id}`,
                message: "Livraison en retard par rapport à la date prévue.", data: { order: id, expectedDate: o.expectedDate } });
        }
    }
    return out;
}

module.exports = { evaluateStockAlerts, evaluateAdjustmentAlerts, evaluateOrderAlerts, SEVERITY };
