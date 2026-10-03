const User = require("./models/User");
const connectDB = require("./config/database");

const test = async () => {
    try {
        await connectDB();

        const user = await User.create({
            firstName: "Ben",
            lastName: "Bop",
            email: "test@pharmaloc.sn",
            phone: "770000001",
            password: "motdepasse123",
            role: "CLIENT"
        });

        console.log("Utilisateur créé :", user);

        process.exit(0);
    } catch (error) {
        console.error("Erreur :", error.message);
        process.exit(1);
    }
};

test();