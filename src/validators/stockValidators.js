const { z } = require("zod");
const { objectId, positiveInt } = require("./common");

const nonNegInt = z.number().int().min(0);

const createStockBody = z.object({
    pharmacy: objectId,
    medicine: objectId,
    quantity: nonNegInt.default(0),
    minimumQuantity: nonNegInt.optional()
});

// La quantité ne se modifie jamais par PATCH : elle passe par un mouvement traçable.
const updateStockBody = z
    .object({
        price: nonNegInt.optional(),
        minimumQuantity: nonNegInt.optional(),
        targetQuantity: nonNegInt.optional(),
        leadTimeDays: nonNegInt.optional(),
        safetyStock: nonNegInt.optional(),
        minOrderQuantity: positiveInt.optional(),
        packSize: positiveInt.optional(),
        quantity: z.any().optional()
    })
    .refine((b) => b.quantity === undefined, {
        path: ["quantity"],
        message: "La quantité ne se modifie pas directement : utilisez POST /api/stocks/:id/movements"
    })
    .refine((b) => Object.keys(b).some((k) => k !== "quantity" && b[k] !== undefined), {
        message: "Aucun champ à modifier"
    });

// Types exposés à l'API. L'entrée en stock passe par une livraison ; péremption et quarantaine par les lots.
const movementBody = z
    .object({
        type: z.enum(["OUT", "RETURN", "LOSS", "BREAKAGE", "ADJUSTMENT"], {
            message: "Type invalide : OUT, RETURN, LOSS, BREAKAGE ou ADJUSTMENT"
        }),
        quantity: positiveInt,
        direction: z.enum(["UP", "DOWN"]).optional(),
        reason: z.string().trim().max(200).optional()
    })
    .superRefine((b, ctx) => {
        if (b.type === "ADJUSTMENT" && !b.direction) {
            ctx.addIssue({ code: "custom", path: ["direction"], message: "direction (UP ou DOWN) obligatoire pour un ajustement" });
        }
        if (b.type !== "ADJUSTMENT" && b.direction) {
            ctx.addIssue({ code: "custom", path: ["direction"], message: "direction réservée aux ajustements" });
        }
        const min = { ADJUSTMENT: 10, LOSS: 5, BREAKAGE: 5 }[b.type];
        if (min && (!b.reason || b.reason.length < min)) {
            ctx.addIssue({ code: "custom", path: ["reason"], message: `Justification obligatoire (${min} caractères minimum)` });
        }
    });

const idempotencyHeader = z.string().trim().min(8).max(100).optional();

module.exports = { createStockBody, updateStockBody, movementBody, idempotencyHeader };