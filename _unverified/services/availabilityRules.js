const STALE_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Statut affiché au patient. La quantité exacte n'est jamais déduite de ce statut.
function availabilityStatus({ sellableQuantity, minimumQuantity = 0, updatedAt, now = new Date() }) {
    const ageDays = (now - new Date(updatedAt)) / DAY_MS;
    if (ageDays > STALE_AFTER_DAYS) return "STALE"; // donnée trop ancienne : on ne promet rien
    if (sellableQuantity <= 0) return "UNAVAILABLE";
    if (sellableQuantity <= minimumQuantity) return "LOW";
    return "AVAILABLE";
}

module.exports = { availabilityStatus, STALE_AFTER_DAYS };
