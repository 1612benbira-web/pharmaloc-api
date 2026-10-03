const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const { createPharmacyBody, updatePharmacyBody, pharmacyListQuery } = require("../validators/catalogAdminValidators");
const c = require("../controllers/pharmacyController");

const router = express.Router();

// Ordre voulu : authentification, rôle, validation, puis traitement.
router.use(authenticate);

router.get("/", validate({ query: pharmacyListQuery }), c.getPharmacies);
router.get("/:id", validate({ params: idParam }), c.getPharmacyById);

router.post("/", requireRole("admin"), validate({ body: createPharmacyBody }), c.createPharmacy);
router.patch("/:id", requireRole("admin", "pharmacy_manager"), validate({ params: idParam, body: updatePharmacyBody }), c.updatePharmacy);
router.delete("/:id", requireRole("admin"), validate({ params: idParam }), c.deletePharmacy);

module.exports = router;