const { assertPharmacyAccess } = require("./accessService");

// Périmètre de lecture d'un utilisateur : une pharmacie précise (accès vérifié) ou toutes les siennes.
function pharmacyScope(user, pharmacyParam) {
    if (pharmacyParam) {
        assertPharmacyAccess(user, pharmacyParam);
        return [pharmacyParam];
    }
    return user.pharmacies;
}

module.exports = { pharmacyScope };
