const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const { createPaymentBody, simulatePaymentBody } = require("../validators/orderValidators");
const { isProduction } = require("../config/env");
const c = require("../controllers/paymentController");

const router = express.Router();

router.use(authenticate);

router.post("/", requireRole("patient"), validate({ body: createPaymentBody }), c.createPayment);
router.get("/:id", requireRole("patient"), validate({ params: idParam }), c.getPayment);

// Simulateur de résultat : n'existe PAS en production.
if (!isProduction) {
    router.post("/:id/simulate", requireRole("admin"), validate({ params: idParam, body: simulatePaymentBody }), c.simulatePayment);
}

module.exports = router;