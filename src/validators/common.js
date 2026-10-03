const { z } = require("zod");

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, "Identifiant invalide");
const positiveInt = z.number().int("Doit être un entier").min(1, "Doit être supérieur à 0");
const idParam = z.object({ id: objectId });

const pagination = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

module.exports = { objectId, positiveInt, idParam, pagination };
