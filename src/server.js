const createApp = require("./app");
const connectDB = require("./config/database");
const { disconnectDB } = connectDB;
const { port, isProduction, checkProductionConfig } = require("./config/env");

async function start() {
    // En production, une configuration dangereuse empêche le démarrage au lieu de passer inaperçue.
    if (isProduction) {
        const { errors, warnings } = checkProductionConfig(process.env);
        warnings.forEach((w) => console.warn("Attention :", w));
        if (errors.length) {
            errors.forEach((e) => console.error("Configuration refusée :", e));
            process.exit(1);
        }
    }

    try {
        await connectDB();
    } catch (error) {
        console.error("Erreur de connexion MongoDB :", error.message);
        process.exit(1);
    }

    const server = createApp().listen(port, () => {
        console.log(`PharmaLoc API lancée sur http://localhost:${port}`);
    });

    // Arrêt propre : on cesse d'accepter des requêtes, on laisse les opérations en cours se terminer, puis on ferme la base.
    const shutdown = (signal) => {
        console.log(`${signal} reçu : arrêt en cours...`);
        setTimeout(() => process.exit(1), 10000).unref(); // filet de sécurité
        server.close(async () => {
            await disconnectDB();
            process.exit(0);
        });
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

start();