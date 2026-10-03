const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const { createStockBody, updateStockBody, movementBody } = require("../validators/stockValidators");
const c = require("../controllers/stockController");

const router = express.Router();

// [v2] Les stocks sont privés : personnel de pharmacie uniquement, limité à ses pharmacies.
// L'administrateur de plateforme n'a volontairement PAS accès aux stocks par défaut.
const staff = requireRole("pharmacist", "pharmacy_manager");
const manager = requireRole("pharmacy_manager");

router.use(authenticate);

router.post("/", manager, validate({ body: createStockBody }), c.createStock);
router.get("/", staff, c.getStocks);
router.get("/:id", staff, validate({ params: idParam }), c.getStockById);
router.patch("/:id", manager, validate({ params: idParam, body: updateStockBody }), c.updateStock);
router.delete("/:id", manager, validate({ params: idParam }), c.deleteStock);

// Mouvements traçables (seul moyen de modifier une quantité)
router.post("/:id/movements", staff, validate({ params: idParam, body: movementBody }), c.createMovement);
router.get("/:id/movements", staff, validate({ params: idParam }), c.getMovements);
router.get("/:id/summary", staff, validate({ params: idParam }), c.getSummary);

module.exports = router;
