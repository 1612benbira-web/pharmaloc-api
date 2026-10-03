const Pharmacy = require("../models/Pharmacy");
const { canAccessPharmacy } = require("../services/accessService");

const createPharmacy = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.create(req.body);

        res.status(201).json({
            message: "Pharmacie créée avec succès",
            pharmacy
        });
    } catch (error) {
        res.status(400).json({
            message: "Erreur lors de la création de la pharmacie",
            error: error.message
        });
    }
};

const getPharmacies = async (req, res) => {
    try {
        const pharmacies = await Pharmacy.find();

        res.status(200).json(pharmacies);
    } catch (error) {
        res.status(500).json({
            message: "Erreur lors de la récupération des pharmacies",
            error: error.message
        });
    }
};

const getPharmacyById = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findById(req.params.id);

        if (!pharmacy) {
            return res.status(404).json({
                message: "Pharmacie introuvable"
            });
        }

        res.status(200).json(pharmacy);
    } catch (error) {
        res.status(400).json({
            message: "ID de pharmacie invalide"
        });
    }
};

const updatePharmacy = async (req, res) => {
    // [v2] Un responsable ne peut modifier que les pharmacies auxquelles il est affecté.
    if (req.user.role !== "admin" && !canAccessPharmacy(req.user, req.params.id)) {
        return res.status(403).json({
            message: "Vous n'avez pas accès à cette pharmacie",
            code: "FORBIDDEN_PHARMACY"
        });
    }
    try {
        const pharmacy = await Pharmacy.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                returnDocument: "after",
                runValidators: true
            }
        );

        if (!pharmacy) {
            return res.status(404).json({
                message: "Pharmacie introuvable"
            });
        }

        res.status(200).json({
            message: "Pharmacie modifiée avec succès",
            pharmacy
        });
    } catch (error) {
        res.status(400).json({
            message: "Erreur lors de la modification",
            error: error.message
        });
    }
};

const deletePharmacy = async (req, res) => {
    try {
        const pharmacy = await Pharmacy.findByIdAndDelete(req.params.id);

        if (!pharmacy) {
            return res.status(404).json({
                message: "Pharmacie introuvable"
            });
        }

        res.status(200).json({
            message: "Pharmacie supprimée avec succès"
        });
    } catch (error) {
        res.status(400).json({
            message: "ID de pharmacie invalide"
        });
    }
};

module.exports = {
    createPharmacy,
    getPharmacies,
    getPharmacyById,
    updatePharmacy,
    deletePharmacy
};