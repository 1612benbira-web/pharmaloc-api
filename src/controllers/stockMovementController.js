const StockMovement = require("../models/StockMovement");

const getStockMovements = async (req, res) => {
    try {
        const movements = await StockMovement.find()
            .populate({
                path: "stock",
                populate: [
                    {
                        path: "pharmacy"
                    },
                    {
                        path: "medicine"
                    }
                ]
            })
            .populate("delivery")
            .sort({ createdAt: -1 });

        res.status(200).json(movements);
    } catch (error) {
        res.status(500).json({
            message: "Erreur lors de la récupération des mouvements",
            error: error.message
        });
    }
};

const getStockMovementById = async (req, res) => {
    try {
        const movement = await StockMovement.findById(req.params.id)
            .populate({
                path: "stock",
                populate: [
                    {
                        path: "pharmacy"
                    },
                    {
                        path: "medicine"
                    }
                ]
            })
            .populate("delivery");

        if (!movement) {
            return res.status(404).json({
                message: "Mouvement introuvable"
            });
        }

        res.status(200).json(movement);
    } catch (error) {
        res.status(400).json({
            message: "ID de mouvement invalide"
        });
    }
};

module.exports = {
    getStockMovements,
    getStockMovementById
};