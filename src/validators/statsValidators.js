const { z } = require("zod");
const { objectId } = require("./common");

// days : période d'analyse (1 à 365 jours) ; pharmacy : une de ses pharmacies (par défaut : toutes les siennes).
const statsQuery = z.object({
    days: z.coerce.number().int().min(1).max(365).default(30),
    pharmacy: objectId.optional()
});

module.exports = { statsQuery };
