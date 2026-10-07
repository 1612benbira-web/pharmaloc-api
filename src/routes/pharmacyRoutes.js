const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { auditAction } = require("../middlewares/audit");
const { idParam } = require("../validators/common");
const { createPharmacyBody, updatePharmacyBody, pharmacyListQuery } = require("../validators/catalogAdminValidators");
const c = require("../controllers/pharmacyController");

const router = express.Router();

// Ordre voulu : authentification, rôle, validation, journal, puis traitement.
router.use(authenticate);

router.get("/", validate({ query: pharmacyListQuery }), c.getPharmacies);
router.get("/:id", validate({ params: idParam }), c.getPharmacyById);

router.post("/", requireRole("admin"), validate({ body: createPharmacyBody }),
    auditAction("PHARMACY_CREATED", { target: (req, body) => body && body.pharmacy && String(body.pharmacy._id), meta: (req) => ({ name: req.valid.body.name }) }),
    c.createPharmacy);
router.patch("/:id", requireRole("admin", "pharmacy_manager"), validate({ params: idParam, body: updatePharmacyBody }),
    auditAction("PHARMACY_UPDATED", { meta: (req) => ({ fields: Object.keys(req.valid.body), ...("isActive" in req.valid.body ? { isActive: req.valid.body.isActive } : {}) }) }),
    c.updatePharmacy);
router.delete("/:id", requireRole("admin"), validate({ params: idParam }), auditAction("PHARMACY_DELETED"), c.deletePharmacy);

module.exports = router;
