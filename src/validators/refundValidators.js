const { z } = require("zod");
const { pagination } = require("./common");

const reason = z.string().trim().min(5, "Précisez le motif (5 caractères minimum)").max(200);

// Corps stricts : un champ inconnu est refusé, jamais ignoré en silence.
const cancelPaidBody = z.strictObject({ reason });
const refundBody = z.strictObject({ reason });
const paymentReviewQuery = pagination.extend({
    needsReview: z.enum(["true", "false"]).default("true").transform((v) => v === "true")
});

module.exports = { cancelPaidBody, refundBody, paymentReviewQuery };
