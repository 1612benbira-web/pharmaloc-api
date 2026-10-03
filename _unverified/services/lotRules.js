// Règles pures sur les lots (aucun accès base : entièrement testables).
const DAY_MS = 24 * 60 * 60 * 1000;

const isExpired = (lot, now = new Date()) => new Date(lot.expiryDate) <= now;

// Vendable = disponible (pas en quarantaine), non périmé, quantité > 0.
const isSellable = (lot, now = new Date()) =>
    lot.status === "AVAILABLE" && !isExpired(lot, now) && lot.quantityRemaining > 0;

const daysUntil = (date, now = new Date()) => Math.ceil((new Date(date) - now) / DAY_MS);

// FEFO : les lots qui expirent en premier sortent en premier. Ne touche jamais aux lots non vendables.
function planFefo(lots, quantity, now = new Date()) {
    const sellable = lots
        .filter((l) => isSellable(l, now))
        .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate) || new Date(a.receivedAt || 0) - new Date(b.receivedAt || 0));
    let remaining = quantity;
    const plan = [];
    for (const lot of sellable) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, lot.quantityRemaining);
        plan.push({ lot: lot._id, quantity: take });
        remaining -= take;
    }
    return { plan, shortfall: remaining };
}

// Répartition du stock d'un produit suivi par lots.
function summarizeLots(lots, now = new Date(), expiringDays = 60) {
    const out = { physical: 0, sellable: 0, quarantined: 0, expired: 0, expiringSoon: 0 };
    for (const lot of lots) {
        const q = lot.quantityRemaining;
        out.physical += q;
        if (isExpired(lot, now)) out.expired += q;
        else if (lot.status === "QUARANTINE") out.quarantined += q;
        else {
            out.sellable += q;
            if (daysUntil(lot.expiryDate, now) <= expiringDays) out.expiringSoon += q;
        }
    }
    return out;
}

// Date de péremption saisie "AAAA-MM-JJ" : valable jusqu'à la fin de ce jour (UTC).
function endOfDayUTC(date) {
    const d = new Date(date);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

module.exports = { DAY_MS, isExpired, isSellable, daysUntil, planFefo, summarizeLots, endOfDayUTC };
