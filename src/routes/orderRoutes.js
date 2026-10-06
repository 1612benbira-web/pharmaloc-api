const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const { createOrderBody, orderListQuery, updateOrderStatusBody } = require("../validators/orderValidators");
const { cancelPaidBody } = require("../validators/refundValidators");
const c = require("../controllers/orderController");
const paid = require("../controllers/paidOrderController");

const router = express.Router();

const patient = requireRole("patient");
const staff = requireRole("pharmacist", "pharmacy_manager");

router.use(authenticate);

router.post("/", patient, validate({ body: createOrderBody }), c.createOrder);
router.get("/mine", patient, validate({ query: orderListQuery }), c.getMyOrders);
router.get("/pharmacy", staff, validate({ query: orderListQuery }), c.getPharmacyOrders);
router.get("/:id", validate({ params: idParam }), c.getOrder);
router.post("/:id/cancel", patient, validate({ params: idParam }), c.cancelOrder);
router.patch("/:id/status", staff, validate({ params: idParam, body: updateOrderStatusBody }), c.updateOrderStatus);

// Annulation d'une commande déjà payée (avec remboursement) : responsable de la pharmacie ou administrateur.
router.post("/:id/cancel-paid", requireRole("pharmacy_manager", "admin"), validate({ params: idParam, body: cancelPaidBody }), paid.cancelPaidOrder);

module.exports = router;
