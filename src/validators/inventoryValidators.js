const { z } = require("zod");
const { objectId, positiveInt, pagination } = require("./common");

const reason = z.string().trim().min(5, "Justification obligatoire (5 caractères minimum)").max(300);

const lotReasonBody = z.object({ reason });
const lotListQuery = pagination.extend({
    stock: objectId.optional(),
    pharmacy: objectId.optional(),
    state: z.enum(["OK", "QUARANTINE", "EXPIRED"]).optional()
});

const createSupplierBody = z.object({
    pharmacy: objectId,
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()).optional()
});
const updateSupplierBody = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    isActive: z.boolean().optional()
}).refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Aucun champ à modifier" });
const supplierListQuery = pagination.extend({ pharmacy: objectId.optional() });

const createOrderBody = z.object({
    pharmacy: objectId,
    supplier: objectId,
    lines: z.array(z.object({ stock: objectId, quantity: positiveInt, unitPrice: z.number().min(0).optional() })).min(1).max(200),
    expectedDate: z.coerce.date().optional(),
    notes: z.string().trim().max(500).optional()
});
const fromSuggestionsBody = z.object({
    pharmacy: objectId,
    supplier: objectId,
    stockIds: z.array(objectId).min(1).max(200),
    expectedDate: z.coerce.date().optional()
});
const transitionBody = z.object({
    to: z.enum(["PENDING_APPROVAL", "DRAFT", "APPROVED", "SENT", "CANCELLED"], {
        message: "Statut demandé invalide (les réceptions sont posées par les livraisons)"
    }),
    reason: z.string().trim().max(300).optional()
});
const orderListQuery = pagination.extend({
    pharmacy: objectId.optional(),
    status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]).optional()
});

const suggestionsQuery = z.object({
    pharmacy: objectId.optional(),
    safetyFactor: z.coerce.number().min(0).max(1).default(0.2),
    all: z.enum(["true", "false"]).default("false").transform((v) => v === "true")
});

const evaluateAlertsBody = z.object({ pharmacy: objectId });
const alertListQuery = pagination.extend({
    pharmacy: objectId.optional(),
    status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional()
});

module.exports = {
    lotReasonBody, lotListQuery, createSupplierBody, updateSupplierBody, supplierListQuery,
    createOrderBody, fromSuggestionsBody, transitionBody, orderListQuery,
    suggestionsQuery, evaluateAlertsBody, alertListQuery
};
