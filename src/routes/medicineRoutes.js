const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { auditAction } = require("../middlewares/audit");
const { idParam } = require("../validators/common");
const { createMedicineBody, updateMedicineBody, medicineListQuery } = require("../validators/catalogAdminValidators");
const c = require("../controllers/medicineController");

const router = express.Router();

// Détails journalisés : noms des champs modifiés, plus l'état de publication et d'ordonnance (jamais d'autre valeur).
const changes = (req) => {
    const b = req.valid.body;
    return {
        fields: Object.keys(b),
        ...("isActive" in b ? { isActive: b.isActive } : {}),
        ...("prescriptionRequired" in b ? { prescriptionRequired: b.prescriptionRequired } : {})
    };
};

// Ordre voulu : authentification, rôle, validation, journal, puis traitement.
router.use(authenticate);

router.get("/", validate({ query: medicineListQuery }), c.listMedicines);
router.get("/:id", validate({ params: idParam }), c.getMedicine);

// Un responsable peut PROPOSER un médicament (créé inactif) ; seul un admin modifie ou supprime le catalogue.
router.post("/", requireRole("admin", "pharmacy_manager"), validate({ body: createMedicineBody }),
    auditAction("MEDICINE_CREATED", { target: (req, body) => body && body.medicine && String(body.medicine._id), meta: (req) => ({ name: req.valid.body.name }) }),
    c.createMedicine);
router.patch("/:id", requireRole("admin"), validate({ params: idParam, body: updateMedicineBody }),
    auditAction("MEDICINE_UPDATED", { meta: changes }), c.updateMedicine);
router.delete("/:id", requireRole("admin"), validate({ params: idParam }), auditAction("MEDICINE_DELETED"), c.deleteMedicine);

module.exports = router;
