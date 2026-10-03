const createApp = require("./app");
const connectDB = require("./config/database");
const { port } = require("./config/env");

async function start() {
    try {
        await connectDB();
    } catch (error) {
        console.error("Erreur de connexion MongoDB :", error.message);
        process.exit(1);
    }

    createApp().listen(port, () => {
        console.log(`PharmaLoc API lancée sur http://localhost:${port}`);
    });
}

start();
