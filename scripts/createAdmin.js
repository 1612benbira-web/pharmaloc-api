// Crée le PREMIER administrateur. Non destructif : refuse si l'e-mail existe déjà.
// Le mot de passe est lu dans l'environnement (jamais affiché, jamais dans le dépôt).
//   PowerShell :
//   $env:ADMIN_EMAIL="admin@exemple.sn"; $env:ADMIN_PASSWORD="<mot de passe de 10+ caractères>"; npm run create-admin
const connectDB = require("../src/config/database");
const { disconnectDB } = connectDB;
const { createUser } = require("../src/services/authService");
const { createStaffBody } = require("../src/validators/authValidators");

(async () => {
    const parsed = createStaffBody.safeParse({
        name: process.env.ADMIN_NAME || "Administrateur",
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
        role: "admin"
    });
    if (!parsed.success) {
        console.error("ADMIN_EMAIL (valide) et ADMIN_PASSWORD (10 caractères minimum) sont requis.");
        process.exit(1);
    }
    try {
        await connectDB();
        const user = await createUser(parsed.data);
        console.log(`Administrateur créé : ${user.email}`);
    } catch (err) {
        console.error(err.code === "EMAIL_TAKEN" ? "Ce compte existe déjà : rien n'a été modifié." : `Échec : ${err.message}`);
        process.exitCode = 1;
    } finally {
        await disconnectDB();
    }
})();
