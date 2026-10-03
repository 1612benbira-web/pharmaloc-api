const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { createDeliveryBody } = require("../validators/deliveryValidators");
const { createDelivery, getDeliveries } = require("../controllers/deliveryController");

const router = express.Router();

router.use(authenticate, requireRole("pharmacist", "pharmacy_manager"));

router.post("/", validate({ body: createDeliveryBody }), createDelivery);
router.get("/", getDeliveries);

module.exports = router;
