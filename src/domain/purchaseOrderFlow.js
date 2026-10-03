// Machine d'états des commandes fournisseurs. Une commande n'augmente JAMAIS le stock :
// seule une livraison réceptionnée le fait.
const TRANSITIONS = {
    DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
    PENDING_APPROVAL: ["APPROVED", "DRAFT", "CANCELLED"],
    APPROVED: ["SENT", "CANCELLED"],
    SENT: ["CANCELLED"],                 // PARTIALLY_RECEIVED / RECEIVED sont posés uniquement par les réceptions
    PARTIALLY_RECEIVED: ["CANCELLED"],
    RECEIVED: [],
    CANCELLED: []
};

// Statuts dont le reste à recevoir compte comme "commandé" dans le réapprovisionnement.
const ON_ORDER_STATUSES = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"];
const RECEIVABLE_STATUSES = ["SENT", "PARTIALLY_RECEIVED"];

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

// Approuver, envoyer ou annuler une commande déjà engagée exige un responsable.
function requiredRole(from, to) {
    if (to === "APPROVED" || to === "SENT") return "pharmacy_manager";
    if (to === "CANCELLED" && from !== "DRAFT") return "pharmacy_manager";
    return "staff";
}

// Statut après une réception, calculé depuis les lignes.
function statusAfterReceipt(lines) {
    const allDone = lines.every((l) => l.quantityReceived >= l.quantityOrdered);
    return allDone ? "RECEIVED" : "PARTIALLY_RECEIVED";
}

module.exports = { TRANSITIONS, ON_ORDER_STATUSES, RECEIVABLE_STATUSES, canTransition, requiredRole, statusAfterReceipt };
