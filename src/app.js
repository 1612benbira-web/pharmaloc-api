const express = require("express");
const mongoose = require("mongoose");
const { notFound, errorHandler } = require("./middlewares/errorHandler");
const originCheck = require("./middlewares/originCheck");
const { allowedOrigins } = require("./config/env");

const medicineRoutes = require("./routes/medicineRoutes");
const pharmacyRoutes = require("./routes/pharmacyRoutes");
const stockRoutes = require("./routes/stockRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const { lotRouter, supplierRouter, orderRouter, replenishmentRouter, alertRouter } = require("./routes/inventoryRoutes");

// Fabrique l'application sans la démarrer (indispensable pour les tests).
function createApp() {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "100kb" }));

    app.use(originCheck(allowedOrigins));

    app.use("/api/auth", authRoutes);
    app.use("/api/admin", adminRoutes);
    app.use("/api/medicines", medicineRoutes);
    app.use("/api/pharmacies", pharmacyRoutes);
    app.use("/api/stocks", stockRoutes);
    app.use("/api/deliveries", deliveryRoutes);
    app.use("/api/lots", lotRouter);
    app.use("/api/suppliers", supplierRouter);
    app.use("/api/purchase-orders", orderRouter);
    app.use("/api/replenishment", replenishmentRouter);
    app.use("/api/alerts", alertRouter);

    app.get("/", (req, res) => {
        res.json({ message: "Bienvenue sur l'API PharmaLoc" });
    });

    app.get("/api/health", (req, res) => {
        const dbUp = mongoose.connection.readyState === 1;
        res.status(dbUp ? 200 : 503).json({
            status: dbUp ? "OK" : "DEGRADED",
            message: "PharmaLoc API fonctionne",
            database: dbUp ? "connected" : "disconnected"
        });
    });

    app.use(notFound);
    app.use(errorHandler);
    return app;
}

module.exports = createApp;
