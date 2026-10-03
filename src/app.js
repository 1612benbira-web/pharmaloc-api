const express = require("express");
const mongoose = require("mongoose");
const { notFound, errorHandler } = require("./middlewares/errorHandler");
const originCheck = require("./middlewares/originCheck");
const cors = require("./middlewares/cors");
const securityHeaders = require("./middlewares/securityHeaders");
const { createLimiters } = require("./middlewares/rateLimit");
const { allowedOrigins, isProduction, trustProxy, rateLimitEnabled } = require("./config/env");

const medicineRoutes = require("./routes/medicineRoutes");
const pharmacyRoutes = require("./routes/pharmacyRoutes");
const stockRoutes = require("./routes/stockRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const catalogRoutes = require("./routes/catalogRoutes");
const shipmentRoutes = require("./routes/shipmentRoutes");
const { lotRouter, supplierRouter, orderRouter, replenishmentRouter, alertRouter } = require("./routes/inventoryRoutes");

// Fabrique l'application sans la démarrer (indispensable pour les tests).
// options.allowedOrigins et options.rateLimit servent aux tests ; en temps normal, tout vient de la configuration.
function createApp(options = {}) {
    const origins = options.allowedOrigins || allowedOrigins;
    const limiters = createLimiters({ enabled: rateLimitEnabled, ...options.rateLimit });

    const app = express();
    app.disable("x-powered-by");
    if (trustProxy > 0) app.set("trust proxy", trustProxy);

    app.use(securityHeaders({ isProduction }));
    app.use(cors(origins));
    app.use(originCheck(origins));
    app.use("/api", limiters.global);
    app.use(express.json({ limit: "100kb" }));

    // Les limiteurs de connexion et d'inscription passent AVANT les routes (et avant la validation).
    app.use("/api/auth/login", limiters.loginByIp, limiters.loginByAccount);
    app.use("/api/auth/register", limiters.register);

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
    app.use("/api/orders", orderRoutes);
    app.use("/api/payments", paymentRoutes);
    app.use("/api/catalog", catalogRoutes);
    app.use("/api/shipments", shipmentRoutes);

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