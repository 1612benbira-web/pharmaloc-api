const express = require("express");
const { authenticate, requireRole } = require("../middlewares/auth");

const {
    createPharmacy,
    getPharmacies,
    getPharmacyById,
    updatePharmacy,
    deletePharmacy
} = require("../controllers/pharmacyController");

const router = express.Router();

router.post("/", authenticate, requireRole("admin"), createPharmacy);

router.get("/", getPharmacies);

router.get("/:id", getPharmacyById);

router.patch("/:id", authenticate, requireRole("admin", "pharmacy_manager"), updatePharmacy);

router.delete("/:id", authenticate, requireRole("admin"), deletePharmacy);

module.exports = router;