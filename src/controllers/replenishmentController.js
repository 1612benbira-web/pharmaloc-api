const { pharmacyScope } = require("../services/scopeService");
const { getSuggestions } = require("../services/replenishmentService");

const suggestions = async (req, res) => {
    const { pharmacy, safetyFactor, all } = req.valid.query;
    const items = await getSuggestions({ pharmacyIds: pharmacyScope(req.user, pharmacy), safetyFactor, includeAll: all });
    res.status(200).json({
        computedAt: new Date(),
        note: "Calcul déterministe : cible - disponible - déjà commandé, puis commande minimale et conditionnement. Aucune commande n'est envoyée.",
        suggestions: items
    });
};

module.exports = { suggestions };
