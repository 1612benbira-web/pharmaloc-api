const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const { shipmentListQuery, orderIdParam, deliverBody, failBody } = require("../validators/shipmentValidators");
const c = require("../controllers/shipmentController");

const router = express.Router();

const courier = requireRole("courier");
const staff = requireRole("pharmacist", "pharmacy_manager");
const patient = requireRole("patient");

router.use(authenticate);

// Livreur
router.get("/available", courier, validate({ query: shipmentListQuery }), c.listAvailable);
router.get("/mine", courier, validate({ query: shipmentListQuery }), c.listMine);
router.post("/:id/claim", courier, validate({ params: idParam }), c.claim);
router.post("/:id/release", courier, validate({ params: idParam }), c.release);
router.post("/:id/pickup", courier, validate({ params: idParam }), c.pickup);
router.post("/:id/deliver", courier, validate({ params: idParam, body: deliverBody }), c.deliver);
router.post("/:id/fail", courier, validate({ params: idParam, body: failBody }), c.fail);

// Personnel de la pharmacie : suivi des courses de ses pharmacies
router.get("/pharmacy", staff, validate({ query: shipmentListQuery }), c.listPharmacy);

// Patient : suivi de sa livraison et code de remise
router.get("/order/:orderId", patient, validate({ params: orderIdParam }), c.getForOrder);

module.exports = router;