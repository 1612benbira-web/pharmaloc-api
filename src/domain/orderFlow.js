// Règles métier PURES des commandes patient : sans base de données, faciles à tester.

const TRANSITIONS = {
    PAYMENT_PENDING: ["CONFIRMED", "CANCELLED", "EXPIRED"],
    CONFIRMED: ["PREPARING"],
    PREPARING: ["READY"],
    READY: ["COMPLETED", "OUT_FOR_DELIVERY"],
    OUT_FOR_DELIVERY: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: [],
    EXPIRED: []
};

// Statuts que le personnel de la pharmacie peut poser. Les autres sont gérés par le système.
const STAFF_TARGETS = ["PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"];

function canTransition(from, to, fulfillment) {
    if (!(TRANSITIONS[from] || []).includes(to)) return false;
    // Seule une livraison à domicile passe par OUT_FOR_DELIVERY, et elle ne peut pas être "retirée" au comptoir.
    if (to === "OUT_FOR_DELIVERY" && fulfillment !== "DELIVERY") return false;
    if (from === "READY" && to === "COMPLETED" && fulfillment === "DELIVERY") return false;
    return true;
}

// Pour une livraison à domicile, la remise au livreur et la livraison appartiennent au livreur
// (course + code de remise) : le personnel ne peut pas les poser à sa place.
const managedByShipment = (fulfillment, to) =>
    fulfillment === "DELIVERY" && (to === "OUT_FOR_DELIVERY" || to === "COMPLETED");

function computeTotals(lines, fulfillment, deliveryFee) {
    const itemsTotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    const fee = fulfillment === "DELIVERY" ? deliveryFee : 0;
    return { itemsTotal, deliveryFee: fee, total: itemsTotal + fee };
}

module.exports = { TRANSITIONS, STAFF_TARGETS, canTransition, managedByShipment, computeTotals };