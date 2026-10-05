// Cree un compte du personnel ou un livreur rattache a une pharmacie (developpement).
// Le mot de passe est lu dans l'environnement : jamais affiche, jamais dans le depot.
const connectDB = require("../src/config/database");
const { disconnectDB } = connectDB;
const Pharmacy = require("../src/models/Pharmacy");
const { createUser } = require("../src/services/authService");
const { createStaffBody } = require("../src/validators/authValidators");

(async () => {
    try {
        await connectDB();
        const pharmacy = await Pharmacy.findOne({ name: process.env.STAFF_PHARMACY });
        if (!pharmacy) throw new Error("Pharmacie introuvable : verifiez STAFF_PHARMACY (nom exact)");

        const parsed = createStaffBody.safeParse({
            name: process.env.STAFF_NAME || "Personnel",
            email: process.env.STAFF_EMAIL,
            password: process.env.STAFF_PASSWORD,
            role: process.env.STAFF_ROLE,
            pharmacies: [String(pharmacy._id)]
        });
        if (!parsed.success) {
            throw new Error("STAFF_EMAIL (valide), STAFF_PASSWORD (10 caracteres minimum) et STAFF_ROLE (pharmacist, pharmacy_manager ou courier) sont requis");
        }
        const user = await createUser(parsed.data);
        console.log("Compte cree : " + user.email + " (" + user.role + ") - " + pharmacy.name);
    } catch (err) {
        console.error(err.code === "EMAIL_TAKEN" ? "Ce compte existe deja : rien n'a ete modifie." : "Echec : " + err.message);
        process.exitCode = 1;
    } finally {
        await disconnectDB();
    }
})();
