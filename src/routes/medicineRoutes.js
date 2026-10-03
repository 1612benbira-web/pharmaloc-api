const express = require("express");
const Medicine = require("../models/Medicine");
const { authenticate, requireRole } = require("../middlewares/auth");

const router = express.Router();

router.post("/", authenticate, requireRole("admin", "pharmacy_manager"), async (req, res) => {
    try {
        const medicine = await Medicine.create(req.body);

        res.status(201).json({
            message: "Médicament créé avec succès",
            medicine
        });
    } catch (error) {
        res.status(400).json({
            message: "Erreur lors de la création du médicament",
            error: error.message
        });
    }
});

router.get("/", async (req, res) => {
    try {
        const medicines = await Medicine.find();

        res.json(medicines);
    } catch (error) {
        res.status(500).json({
            message: "Erreur lors de la récupération des médicaments",
            error: error.message
        });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const medicine = await Medicine.findById(req.params.id);

        if (!medicine) {
            return res.status(404).json({
                message: "Médicament introuvable"
            });
        }

        res.json(medicine);
    } catch (error) {
        res.status(400).json({
            message: "ID invalide"
        });
    }
});

router.patch("/:id", authenticate, requireRole("admin", "pharmacy_manager"), async (req, res) => {
    try {
        const medicine = await Medicine.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                returnDocument: "after",
                runValidators: true
            }
        );

        if (!medicine) {
            return res.status(404).json({
                message: "Médicament introuvable"
            });
        }

        res.json({
            message: "Médicament modifié avec succès",
            medicine
        });
    } catch (error) {
        res.status(400).json({
            message: "Erreur lors de la modification",
            error: error.message
        });
    }
});

router.delete("/:id", authenticate, requireRole("admin"), async (req, res) => {
    try {
        const medicine = await Medicine.findByIdAndDelete(req.params.id);

        if (!medicine) {
            return res.status(404).json({
                message: "Médicament introuvable"
            });
        }

        res.json({
            message: "Médicament supprimé avec succès"
        });
    } catch (error) {
        res.status(400).json({
            message: "ID invalide"
        });
    }
});

module.exports = router;