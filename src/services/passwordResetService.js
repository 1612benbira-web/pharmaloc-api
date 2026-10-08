const crypto = require("crypto");
const User = require("../models/User");
const Session = require("../models/Session");
const PasswordReset = require("../models/PasswordReset");
const AppError = require("../utils/AppError");
const { hashPassword } = require("./passwordService");
const mailer = require("./mailer");
const { appUrl, isProduction } = require("../config/env");

const TTL_MS = 30 * 60 * 1000;
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

/**
 * Demande de réinitialisation. Ne révèle JAMAIS si le compte existe : un e-mail inconnu ou un compte suspendu
 * ne produit simplement rien. Un nouveau lien invalide les précédents.
 */
async function requestReset(email) {
    const user = await User.findOne({ email, isActive: true });
    if (!user) return;

    if (isProduction && !/^https:\/\//.test(appUrl)) {
        throw new Error("APP_URL doit être une adresse https en production : e-mail de réinitialisation non envoyé");
    }

    await PasswordReset.deleteMany({ user: user._id, usedAt: { $exists: false } });
    const token = crypto.randomBytes(32).toString("hex");
    await PasswordReset.create({ user: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS) });
    await mailer.sendPasswordReset({ to: user.email, name: user.name, link: `${appUrl}/reinitialiser?token=${token}` });
}

/**
 * Nouveau mot de passe grâce au lien reçu par e-mail. Le jeton est consommé de façon atomique (usage unique).
 * Toutes les sessions du compte sont fermées, et le compte est déverrouillé (la preuve de possession de l'e-mail suffit).
 */
async function resetPassword({ token, newPassword }) {
    const invalid = () => new AppError(400, "Ce lien est invalide ou a expiré. Demandez-en un nouveau.", "INVALID_RESET_TOKEN");

    const record = await PasswordReset.findOneAndUpdate(
        { tokenHash: sha256(token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
        { usedAt: new Date() },
        { returnDocument: "after" }
    );
    if (!record) throw invalid();

    const user = await User.findById(record.user);
    if (!user || !user.isActive) throw invalid();

    await User.updateOne(
        { _id: user._id },
        { passwordHash: await hashPassword(newPassword), mustChangePassword: false, failedLoginCount: 0, $unset: { lockUntil: 1 } }
    );
    await Session.updateMany({ user: user._id, revokedAt: { $exists: false } }, { revokedAt: new Date() });
    await PasswordReset.deleteMany({ user: user._id });
}

module.exports = { requestReset, resetPassword };
