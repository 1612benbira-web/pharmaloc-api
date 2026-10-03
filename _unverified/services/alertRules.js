const { isExpired, daysUntil, summarizeLots } = require("./lotRules");

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const id = (v) => String(v && v._id ? v._id : v);

/**
 * Calcule les alertes à partir de l'état courant. Fonction pure et à la demande :
 * une même situation produit toujours UNE seule alerte (clé unique) -> pas de doublons.
 */
function computeAlerts({ stocks, lots, orders = [], consumption = {}, now = new Date(), expiringDays = 60 }) {
    const alerts = [];
    const lotsByStock = new Map();
    for (const lot of lots) {
        const k = id(lot.stock);
        if (!lotsByStock.has(k)) lotsByStock.set(k, []);
        lotsByStock.get(k).push(lot);
    }
    const stockById = new Map(stocks.map((s) => [id(s), s]));
    const base = (s) => ({ pharmacy: id(s.pharmacy), medicine: id(s.medicine), stock: id(s) });

    for (const s of stocks) {
        const sid = id(s);
        if (s.quantity === 0) {
            alerts.push({ key: `OUT_OF_STOCK:${sid}`, type: "OUT_OF_STOCK", severity: "critical", message: "Rupture de stock", ...base(s) });
        } else if (s.quantity <= s.minimumQuantity) {
            alerts.push({ key: `LOW_STOCK:${sid}`, type: "LOW_STOCK", severity: "warning",
                message: `Stock (${s.quantity}) sous ou égal au seuil minimum (${s.minimumQuantity})`, ...base(s) });
        }

        if (s.tracksLots && s.quantity > 0) {
            const sum = summarizeLots(lotsByStock.get(sid) || [], now, expiringDays);
            if (sum.sellable === 0) {
                alerts.push({ key: `NO_SELLABLE_STOCK:${sid}`, type: "NO_SELLABLE_STOCK", severity: "critical",
                    message: "Du stock existe mais rien n'est vendable (lots périmés ou en quarantaine)", ...base(s) });
            }
        }

        const perDay = consumption[sid];
        if (perDay > 0 && s.quantity > 0 && s.leadTimeDays > 0) {
            const daysOfCover = s.quantity / perDay;
            if (daysOfCover < s.leadTimeDays) {
                alerts.push({ key: `STOCKOUT_RISK:${sid}`, type: "STOCKOUT_RISK", severity: "warning",
                    message: `Rupture probable : environ ${Math.floor(daysOfCover)} jour(s) de stock pour un délai de livraison de ${s.leadTimeDays} jour(s) (estimation)`, ...base(s) });
            }
        }
    }

    for (const lot of lots) {
        if (lot.quantityRemaining <= 0) continue;
        const s = stockById.get(id(lot.stock));
        const ctx = { pharmacy: id(lot.pharmacy), medicine: id(lot.medicine), stock: id(lot.stock), lot: id(lot), lotNumber: lot.lotNumber };
        if (isExpired(lot, now)) {
            alerts.push({ key: `LOT_EXPIRED:${id(lot)}`, type: "LOT_EXPIRED", severity: "critical",
                message: `Lot ${lot.lotNumber} périmé (${lot.quantityRemaining} unité(s) à retirer)`, ...ctx });
        } else {
            const days = daysUntil(lot.expiryDate, now);
            if (days <= expiringDays) {
                alerts.push({ key: `LOT_EXPIRING:${id(lot)}`, type: "LOT_EXPIRING", severity: days <= 14 ? "critical" : "warning",
                    message: `Lot ${lot.lotNumber} expire dans ${days} jour(s)`, daysLeft: days, ...ctx });
            }
        }
        void s;
    }

    for (const o of orders) {
        const ctx = { pharmacy: id(o.pharmacy), order: id(o) };
        if (o.status === "DRAFT") {
            alerts.push({ key: `ORDER_PENDING_APPROVAL:${id(o)}`, type: "ORDER_PENDING_APPROVAL", severity: "info",
                message: "Commande en brouillon en attente de validation", ...ctx });
        }
        if (["SUBMITTED", "PARTIALLY_RECEIVED"].includes(o.status) && o.expectedDate && new Date(o.expectedDate) < now) {
            alerts.push({ key: `LATE_DELIVERY:${id(o)}`, type: "LATE_DELIVERY", severity: "warning",
                message: "Livraison en retard par rapport à la date prévue", ...ctx });
        }
    }

    return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.key.localeCompare(b.key));
}

module.exports = { computeAlerts };
