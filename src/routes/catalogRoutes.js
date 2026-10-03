const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const { medicineSearchQuery, availabilityQuery, pharmacySearchQuery } = require("../validators/catalogValidators");
const c = require("../controllers/catalogController");

const router = express.Router();

// Connexion requise : les disponibilités des pharmacies ne doivent pas pouvoir être aspirées anonymement.
router.use(authenticate);

router.get("/medicines", validate({ query: medicineSearchQuery }), c.searchMedicines);
router.get("/medicines/:id/availability", validate({ params: idParam, query: availabilityQuery }), c.getAvailability);
router.get("/pharmacies", validate({ query: pharmacySearchQuery }), c.searchPharmacies);

module.exports = router;