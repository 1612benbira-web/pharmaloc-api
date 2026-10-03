// Règles métier PURES (sans base de données) : faciles à tester et à expliquer au jury.
const DAY_MS = 24 * 60 * 60 * 1000;

// Classification d'un lot. Un lot en quarantaine, périmé ou proche de la péremption n'est jamais "OK".
function classifyLot(lot, now = new Date(), nearDays = 30) {
    if (lot.state === "QUARANTINE") return "QUARANTINE";
    const expiry = new Date(lot.expiryDate);
    if (lot.state === "EXPIRED" || expiry <= now) return "EXPIRED";
    if (expiry - now <= nearDays * DAY_MS) return "NEAR_EXPIRY";
    return "OK";
}

// Un lot est vendable s'il est actif, non périmé et non vide.
const isSellable = (lot, now = new Date()) =>
    lot.state === "OK" && new Date(lot.expiryDate) > now && lot.remainingQuantity > 0;

/**
 * FEFO (First Expired, First Out) : propose dans quels lots prélever.
 * Retourne { allocations: [{ lot, quantity }], fromLots, remainder }.
 * `remainder` = quantité qui ne vient d'aucun lot vendable (stock "sans lot").
 */
function planFEFO(lots, quantity, now = new Date()) {
    const sellable = lots
        .filter((l) => isSellable(l, now))
        .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate) || String(a.lotNumber).localeCompare(String(b.lotNumber)));

    let need = quantity;
    const allocations = [];
    for (const lot of sellable) {
        if (need <= 0) break;
        const take = Math.min(lot.remainingQuantity, need);
        allocations.push({ lot: lot._id, quantity: take });
        need -= take;
    }
    return { allocations, fromLots: quantity - need, remainder: need };
}

// Le stock a une quantité négative ou nulle, ou passe SOUS le seuil minimum (strictement).
const isLowStock = ({ quantity, minimumQuantity }) =>
    quantity > 0 && minimumQuantity > 0 && quantity < minimumQuantity;

// Statut de disponibilité destiné à l'affichage patient. Ne "devine" jamais : donnée absente ou trop ancienne => dit-le.
function availabilityStatus({ quantity, minimumQuantity = 0, updatedAt, now = new Date(), staleAfterHours = 72 }) {
    if (quantity === undefined || quantity === null || !updatedAt) return "UNCONFIRMED";
    if (now - new Date(updatedAt) > staleAfterHours * 60 * 60 * 1000) return "STALE";
    if (quantity <= 0) return "OUT_OF_STOCK";
    if (isLowStock({ quantity, minimumQuantity })) return "LOW";
    return "AVAILABLE";
}

// Types de mouvements et leur sens. ADJUSTMENT est signé : il dépend de `direction`.
const IN_TYPES = ["IN", "RETURN", "RELEASE"];
const OUT_TYPES = ["OUT", "LOSS", "BREAKAGE", "EXPIRY", "QUARANTINE"];

function movementDelta(type, quantity, direction) {
    if (type === "ADJUSTMENT") {
        if (direction !== "UP" && direction !== "DOWN") throw new Error("direction requise (UP/DOWN) pour un ajustement");
        return direction === "UP" ? quantity : -quantity;
    }
    if (IN_TYPES.includes(type)) return quantity;
    if (OUT_TYPES.includes(type)) return -quantity;
    throw new Error(`Type de mouvement inconnu : ${type}`);
}

module.exports = {
    DAY_MS, classifyLot, isSellable, planFEFO, isLowStock, availabilityStatus,
    movementDelta, IN_TYPES, OUT_TYPES
};
