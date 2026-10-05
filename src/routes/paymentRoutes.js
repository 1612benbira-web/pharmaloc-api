const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const { createPaymentBody, simulatePaymentBody } = require("../validators/orderValidators");
const { orderIdParam } = require("../validators/shipmentValidators");
const { isProduction } = require("../config/env");
const c = require("../controllers/paymentController");

const router = express.Router();

router.use(authenticate);

router.post("/", requireRole("patient"), validate({ body: createPaymentBody }), c.createPayment);
router.get("/:id", requireRole("patient"), validate({ params: idParam }), c.getPayment);

// Simulateurs de résultat : n'existent PAS en production.
if (!isProduction) {
    router.post("/:id/simulate", requireRole("admin"), validate({ params: idParam, body: simulatePaymentBody }), c.simulatePayment);
    router.post("/order/:orderId/simulate", requireRole("patient"), validate({ params: orderIdParam, body: simulatePaymentBody }), c.simulateMyPayment);
}

module.exports = router;
