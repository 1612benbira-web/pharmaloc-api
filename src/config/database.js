const mongoose = require("mongoose");
const { getMongoUri } = require("./env");

// Ne quitte plus le processus : c'est server.js qui décide quoi faire en cas d'échec.
const connectDB = async (uri = getMongoUri()) => {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log("MongoDB connecté avec succès");
};

const disconnectDB = () => mongoose.disconnect();

module.exports = connectDB;
module.exports.disconnectDB = disconnectDB;
