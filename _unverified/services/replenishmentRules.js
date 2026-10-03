// Calculs de réapprovisionnement DÉTERMINISTES. L'IA pourra les expliquer, jamais les remplacer.
const MIN_SALES_FOR_ESTIMATE = 5;
const MIN_DAYS_OF_DATA = 14;
const WINDOW_DAYS = 30;

// sales : [{ quantity }] ventes appliquées sur la fenêtre ; stockAgeDays : ancienneté du stock.
function estimateDailyConsumption({ sales, stockAgeDays, windowDays = WINDOW_DAYS }) {
    if (sales.length < MIN_SALES_FOR_ESTIMATE || stockAgeDays < MIN_DAYS_OF_DATA) {
        return {
            perDay: null, sufficient: false,
            reason: `Historique insuffisant (${sales.length} vente(s), ${Math.floor(stockAgeDays)} jour(s) de données ; minimum ${MIN_SALES_FOR_ESTIMATE} ventes et ${MIN_DAYS_OF_DATA} jours)`
        };
    }
    const total = sales.reduce((sum, s) => sum + s.quantity, 0);
    const days = Math.min(windowDays, stockAgeDays);
    return { perDay: total / days, sufficient: true, reason: `Moyenne sur ${Math.floor(days)} jours` };
}

const roundUpTo = (value, step) => Math.ceil(value / step) * step;

/**
 * Quantité suggérée = cible - disponible - déjà commandé non reçu, puis contraintes de conditionnement.
 * Ne suggère rien tant que le stock disponible reste au-dessus du point de commande.
 */
function suggestQuantity({
    minimumQuantity = 0, targetQuantity, availableStock, onOrder = 0, dailyConsumption = null,
    leadTimeDays = 0, safetyStock = 0, minOrderQuantity = 1, packSize = 1
}) {
    const assumptions = [];
    const demandDuringLead = dailyConsumption != null ? Math.ceil(dailyConsumption * leadTimeDays) : 0;
    const reorderPoint = Math.max(minimumQuantity, demandDuringLead + safetyStock);

    let target = targetQuantity;
    let basis = "MANUAL_TARGET";
    if (target == null) {
        target = minimumQuantity * 2;
        basis = "MINIMUM_RULE";
        assumptions.push("Aucun stock cible défini : cible estimée à 2 x le seuil minimum. Définissez un stock cible pour plus de précision.");
    }
    if (dailyConsumption != null) {
        const salesTarget = demandDuringLead + safetyStock + minimumQuantity;
        if (salesTarget > target) {
            target = salesTarget;
            basis = "SALES_HISTORY";
            assumptions.push("Cible relevée pour couvrir la demande estimée pendant le délai de livraison + stock de sécurité.");
        }
    } else {
        assumptions.push("Consommation non estimée (historique de ventes insuffisant) : calcul basé sur la cible et le seuil uniquement.");
    }

    const covered = availableStock + onOrder;
    const need = target - covered;
    const result = { target, reorderPoint, need: Math.max(need, 0), basis, assumptions, onOrder, availableStock };

    if (availableStock > reorderPoint || need <= 0) return { ...result, suggested: 0 };

    let qty = roundUpTo(need, packSize);
    if (qty < minOrderQuantity) qty = roundUpTo(minOrderQuantity, packSize);
    return { ...result, suggested: qty };
}

module.exports = { estimateDailyConsumption, suggestQuantity, MIN_SALES_FOR_ESTIMATE, MIN_DAYS_OF_DATA, WINDOW_DAYS };
