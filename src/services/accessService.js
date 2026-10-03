const AppError = require("../utils/AppError");

const STAFF_ROLES = ["pharmacist", "pharmacy_manager"];

const canAccessPharmacy = (user, pharmacyId) =>
    (user.pharmacies || []).some((p) => String(p) === String(pharmacyId));

// Lève 403 si l'utilisateur n'est pas affecté à cette pharmacie.
function assertPharmacyAccess(user, pharmacyId) {
    if (!canAccessPharmacy(user, pharmacyId)) {
        throw new AppError(403, "Vous n'avez pas accès à cette pharmacie", "FORBIDDEN_PHARMACY");
    }
}

module.exports = { STAFF_ROLES, canAccessPharmacy, assertPharmacyAccess };
