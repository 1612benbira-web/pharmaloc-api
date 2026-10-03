// Vérifie la connexion MongoDB : type de base, nom, collections. Aucun secret n'est affiché.
const mongoose = require("mongoose");
const connectDB = require("../src/config/database");
const { disconnectDB } = connectDB;
const { getMongoUri } = require("../src/config/env");

(async () => {
    try {
        const uri = getMongoUri();
        const host = (uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?([^/?]+)/) || [])[1] || "inconnu";
        await connectDB();

        const db = mongoose.connection.db;
        console.log("Serveur      :", /mongodb\.net$/.test(host) ? "MongoDB Atlas" : "MongoDB local ou autre");
        console.log("Hôte         :", host);
        console.log("Base         :", mongoose.connection.name);
        console.log("Mongoose     :", mongoose.version);

        const collections = await db.listCollections().toArray();
        if (collections.length === 0) console.log("Collections  : aucune (elles se créent à la première écriture)");
        for (const c of collections) {
            console.log(`  - ${c.name} : ${await db.collection(c.name).countDocuments()} document(s)`);
        }
    } catch (err) {
        console.error("Connexion impossible :", err.message);
        process.exitCode = 1;
    } finally {
        await disconnectDB();
    }
})();