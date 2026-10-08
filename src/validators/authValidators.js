const { z } = require("zod");
const { objectId } = require("./common");

const email = z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide"));
const password = z.string().min(10, "10 caractères minimum").max(128, "128 caractères maximum");

// Un patient ne choisit JAMAIS son rôle : tout champ "role" envoyé est ignoré.
const registerBody = z.object({ name: z.string().trim().min(2).max(120), email, password });
const loginBody = z.object({ email, password: z.string().min(1).max(128) });

const createStaffBody = z.object({
    name: z.string().trim().min(2).max(120),
    email,
    password,
    role: z.enum(["pharmacist", "pharmacy_manager", "courier", "admin"]),
    pharmacies: z.array(objectId).max(50).default([])
});

// Corps strict : un champ inconnu est refusé, jamais ignoré en silence.
const changePasswordBody = z.strictObject({
    currentPassword: z.string().min(1, "Le mot de passe actuel est obligatoire").max(128),
    newPassword: password
});

// « Mot de passe oublié » : l'e-mail, puis le jeton reçu (64 caractères hexadécimaux) et le nouveau mot de passe.
const forgotPasswordBody = z.strictObject({ email });
const resetPasswordBody = z.strictObject({
    token: z.string().regex(/^[a-f0-9]{64}$/, "Lien invalide"),
    newPassword: password
});

module.exports = { registerBody, loginBody, createStaffBody, changePasswordBody, forgotPasswordBody, resetPasswordBody };
