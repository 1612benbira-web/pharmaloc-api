const { z } = require("zod");
const { objectId, positiveInt } = require("./common");

const createDeliveryBody = z
    .object({
        pharmacy: objectId,
        medicine: objectId,
        quantity: positiveInt,
        supplier: z.string().trim().max(120).optional(),
        reference: z.string().trim().max(120).optional(),
        deliveryDate: z.coerce.date().optional(),
        lotNumber: z.string().trim().min(1).max(60).optional(),
        expiryDate: z.coerce.date().optional(),
        unitPrice: z.number().min(0).optional(),
        purchaseOrder: objectId.optional()
    })
    .refine((b) => Boolean(b.lotNumber) === Boolean(b.expiryDate), {
        path: ["lotNumber"],
        message: "Le numéro de lot et la date de péremption vont ensemble : ne devinez pas une valeur manquante"
    });

module.exports = { createDeliveryBody };
