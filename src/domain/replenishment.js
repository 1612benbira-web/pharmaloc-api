// Calcul DÉTERMINISTE du réapprovisionnement. L'IA pourra l'expliquer, jamais le remplacer.
const { DAY_MS } = require("./stockMath");

const roundUpTo = (value, step) => Math.ceil(value / step) * step;

/**
 * Estime la consommation quotidienne à partir des VENTES seules (OUT), pas des pertes ni péremptions.
 * `sales` : [{ quantity, createdAt }] sur la fenêtre observée.
 * Si l'historique est trop court, on refuse d'estimer plutôt que d'inventer.
 */
function estimateFromTotals({ total, count, earliest }, { now = new Date(), windowDays = 30, minDays = 14, minSales = 5 } = {}) {
    if (!count) return { dailyDemand: null, confidence: "INSUFFICIENT", note: "Aucune vente sur la période." };
    const spanDays = Math.min(windowDays, Math.max(1, Math.ceil((now - new Date(earliest)) / DAY_MS)));
    if (spanDays < minDays || count < minSales) {
        return {
            dailyDemand: null, confidence: "INSUFFICIENT",
            note: `Historique trop court (${spanDays} jour(s), ${count} vente(s)) : minimum ${minDays} jours et ${minSales} ventes.`
        };
    }
    return {
        dailyDemand: total / spanDays,
        confidence: count >= 20 ? "OK" : "LOW",
        note: `Moyenne sur ${spanDays} jour(s) (${count} ventes). Ne tient pas compte de la saisonnalité.`
    };
}

function estimateDailyDemand(sales, options = {}) {
    const { now = new Date(), windowDays = 30 } = options;
    const inWindow = sales.filter((s) => now - new Date(s.createdAt) <= windowDays * DAY_MS);
    if (inWindow.length === 0) return estimateFromTotals({ count: 0 }, options);
    return estimateFromTotals({
        total: inWindow.reduce((sum, s) => sum + s.quantity, 0),
        count: inWindow.length,
        earliest: Math.min(...inWindow.map((s) => new Date(s.createdAt).getTime()))
    }, options);
}

/**
 * Quantité suggérée.
 *  Règle de base : cible - disponible - déjà commandé non reçu.
 *  Si la demande est connue : la cible effective est au moins (demande pendant le délai * (1 + marge)) + stock de sécurité.
 *  Puis : commande minimale, puis arrondi au conditionnement fournisseur (toujours vers le haut).
 */
function suggestOrderQuantity({
    targetQuantity = null, availableQuantity, onOrderQuantity = 0,
    minOrderQuantity = 1, packSize = 1, dailyDemand = null,
    leadTimeDays = 0, safetyStock = 0, safetyFactor = 0
}) {
    const pack = Math.max(1, packSize);
    const minOrder = Math.max(1, minOrderQuantity);

    const hasDemand = dailyDemand !== null && dailyDemand > 0;
    const demandTarget = hasDemand ? Math.ceil(dailyDemand * leadTimeDays * (1 + safetyFactor) + safetyStock) : null;

    if (targetQuantity === null && demandTarget === null) {
        return { quantity: 0, reason: "INSUFFICIENT_DATA", method: null, rawNeed: null, effectiveTarget: null,
            explanation: "Ni stock cible ni historique de ventes suffisant : aucune suggestion fiable." };
    }

    const effectiveTarget = Math.max(targetQuantity ?? 0, demandTarget ?? 0);
    const method = demandTarget !== null && demandTarget > (targetQuantity ?? 0) ? "DEMAND" : "TARGET";
    const rawNeed = effectiveTarget - availableQuantity - onOrderQuantity;

    if (rawNeed <= 0) {
        return { quantity: 0, reason: "NOT_NEEDED", method, rawNeed, effectiveTarget,
            explanation: "Le stock disponible et les commandes en cours couvrent la cible." };
    }

    const quantity = roundUpTo(Math.max(rawNeed, minOrder), pack);
    return {
        quantity, reason: "REPLENISH", method, rawNeed, effectiveTarget,
        explanation:
            `Cible ${effectiveTarget} - disponible ${availableQuantity} - commandé ${onOrderQuantity} = ${rawNeed}` +
            `${rawNeed < minOrder ? `, relevé au minimum de commande ${minOrder}` : ""}` +
            `${pack > 1 ? `, arrondi au conditionnement de ${pack}` : ""} => ${quantity}.`
    };
}

module.exports = { estimateDailyDemand, estimateFromTotals, suggestOrderQuantity };
