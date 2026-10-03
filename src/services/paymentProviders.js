const crypto = require("crypto");
const AppError = require("../utils/AppError");
const { isProduction } = require("../config/env");

// Prestataire SIMULÉ : sert à tester tout le parcours. Il n'encaisse rien.
// Pour un vrai prestataire (Wave, Orange Money...), ajouter ici un objet avec la même méthode
// initiate(...) et le choisir selon `method` dans getProvider. Le reste de l'application ne change pas.
const mock = {
    async initiate() {
        return { transactionId: `MOCK-${crypto.randomUUID()}`, status: "PROCESSING" };
    }
};

function getProvider() {
    if (isProduction) {
        // Garde-fou : en production, aucune commande ne doit pouvoir être "payée" par le simulateur.
        throw new AppError(501, "Aucun prestataire de paiement n'est encore configuré", "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
    return mock;
}

module.exports = { getProvider };