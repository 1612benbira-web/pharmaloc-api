const { z } = require("zod");
const { objectId, positiveInt, pagination } = require("./common");

const ORDER_STATUSES = ["PAYMENT_PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED", "EXPIRED"];

// Le client n'envoie JAMAIS de prix ni de total : tout champ inconnu est ignoré.
const createOrderBody = z
    .object({
        pharmacy: objectId,
        items: z
            .array(z.object({ medicine: objectId, quantity: positiveInt.max(50, "50 unités maximum par article") }))
            .min(1, "Au moins un article")
            .max(30, "30 articles maximum"),
        fulfillment: z.enum(["PICKUP", "DELIVERY"]),
        deliveryAddress: z.string().trim().min(5).max(300).optional()
    })
    .superRefine((b, ctx) => {
        if (b.fulfillment === "DELIVERY" && !b.deliveryAddress) {
            ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Adresse de livraison obligatoire" });
        }
        const ids = b.items.map((i) => i.medicine);
        if (new Set(ids).size !== ids.length) {
            ctx.addIssue({ code: "custom", path: ["items"], message: "Un médicament ne peut apparaître qu'une seule fois" });
        }
    });

const orderListQuery = pagination.extend({ status: z.enum(ORDER_STATUSES).optional() });

const updateOrderStatusBody = z.object({
    status: z.enum(["PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"])
});

const createPaymentBody = z.object({
    orderId: objectId,
    method: z.enum(["WAVE", "ORANGE_MONEY", "FREE_MONEY", "CARD"])
});

const simulatePaymentBody = z.object({ outcome: z.enum(["PAID", "FAILED"]) });

module.exports = { createOrderBody, orderListQuery, updateOrderStatusBody, createPaymentBody, simulatePaymentBody };