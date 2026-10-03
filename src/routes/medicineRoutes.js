const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const { createMedicineBody, updateMedicineBody, medicineListQuery } = require("../validators/catalogAdminValidators");
const c = require("../controllers/medicineController");

const router = express.Router();

// Ordre voulu : authentification, rôle, validation, puis traitement.
router.use(authenticate);

router.get("/", validate({ query: medicineListQuery }), c.listMedicines);
router.get("/:id", validate({ params: idParam }), c.getMedicine);

// Un responsable peut PROPOSER un médicament (créé inactif) ; seul un admin modifie ou supprime le catalogue.
router.post("/", requireRole("admin", "pharmacy_manager"), validate({ body: createMedicineBody }), c.createMedicine);
router.patch("/:id", requireRole("admin"), validate({ params: idParam, body: updateMedicineBody }), c.updateMedicine);
router.delete("/:id", requireRole("admin"), validate({ params: idParam }), c.deleteMedicine);

module.exports = router;