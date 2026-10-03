const { z } = require("zod");
const { objectId, pagination } = require("./common");

const SHIPMENT_STATUSES = ["PENDING", "ASSIGNED", "PICKED_UP", "DELIVERED", "FAILED"];

const shipmentListQuery = pagination.extend({ status: z.enum(SHIPMENT_STATUSES).optional() });
const orderIdParam = z.object({ orderId: objectId });
const deliverBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Le code comporte 6 chiffres") });
const failBody = z.object({ reason: z.string().trim().min(5, "Précisez le motif").max(200) });

module.exports = { shipmentListQuery, orderIdParam, deliverBody, failBody };