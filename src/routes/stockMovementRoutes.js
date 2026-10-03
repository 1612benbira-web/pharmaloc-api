const express = require("express");

const {
    getStockMovements,
    getStockMovementById
} = require("../controllers/stockMovementController");

const router = express.Router();

router.get("/", getStockMovements);
router.get("/:id", getStockMovementById);

module.exports = router;