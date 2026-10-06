const crypto = require("crypto");
const User = require("../models/User");
const Session = require("../models/Session");
const AppError = require("../utils/AppError");
const { hashPassword, verifyPassword } = require("./passwordService");

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

// Hash factice : on fait le même travail pour un e-mail inconnu (évite de révéler quels comptes existent).
let dummyHashPromise;
const getDummyHash = () => (dummyHashPromise ||= hashPassword("mot-de-passe-factice-inutilisable"));

async function createUser({ name, email, password, role = "patient", pharmacies = [], mustChangePassword = false }) {
    const passwordHash = await hashPassword(password);
    try {
        return await User.create({ name, email, passwordHash, role, pharmacies, mustChangePassword });
    } catch (err) {
        if (err && err.code === 11000) {
            throw new AppError(409, "Un compte existe déjà avec cette adresse e-mail", "EMAIL_TAKEN");
        }
        throw err;
    }
}

async function createSession(user, userAgent) {
    const token = crypto.randomBytes(32).toString("hex");
    await Session.create({
        user: user._id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined
    });
    return { token, maxAgeMs: SESSION_TTL_MS };
}

// Compte un échec (connexion ou changement de mot de passe) et verrouille le compte au-delà du seuil.
async function registerFailure(userId) {
    // $inc atomique, puis relecture du compteur (deux échecs simultanés comptent tous les deux).
    await User.updateOne({ _id: userId }, { $inc: { failedLoginCount: 1 } });
    const updated = await User.findById(userId);
    if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
        await User.updateOne({ _id: userId }, { lockUntil: new Date(Date.now() + LOCK_MS), failedLoginCount: 0 });
    }
}

async function login(email, password, userAgent) {
    const invalid = new AppError(401, "E-mail ou mot de passe incorrect", "INVALID_CREDENTIALS");
    const user = await User.findOne({ email }).select("+passwordHash");

    if (!user) {
        await verifyPassword(password, await getDummyHash());
        throw invalid;
    }

    if (user.lockUntil && user.lockUntil > new Date()) {
        throw new AppError(429, "Compte temporairement verrouillé après trop d'échecs. Réessayez plus tard.", "ACCOUNT_LOCKED");
    }

    if (!(await verifyPassword(password, user.passwordHash)) || !user.isActive) {
        await registerFailure(user._id);
        throw invalid;
    }

    await User.updateOne({ _id: user._id }, { failedLoginCount: 0, $unset: { lockUntil: 1 } });
    const session = await createSession(user, userAgent);
    return { user, ...session };
}

/**
 * Changement de mot de passe par son titulaire, déjà connecté.
 *  - le mot de passe actuel est exigé ; un mauvais essai compte comme un échec de connexion
 *    (5 échecs verrouillent le compte), pour qu'une session volée ne serve pas à le deviner ;
 *  - toutes les AUTRES sessions sont fermées : seule la session en cours reste ouverte.
 */
async function changePassword({ userId, currentPassword, newPassword, keepSessionId }) {
    const user = await User.findById(userId).select("+passwordHash");
    if (!user) throw new AppError(404, "Compte introuvable", "USER_NOT_FOUND");

    if (user.lockUntil && user.lockUntil > new Date()) {
        throw new AppError(429, "Compte temporairement verrouillé après trop d'échecs. Réessayez plus tard.", "ACCOUNT_LOCKED");
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        await registerFailure(user._id);
        throw new AppError(400, "Le mot de passe actuel est incorrect", "INVALID_CURRENT_PASSWORD");
    }
    if (await verifyPassword(newPassword, user.passwordHash)) {
        throw new AppError(400, "Le nouveau mot de passe doit être différent de l'ancien", "PASSWORD_UNCHANGED");
    }

    await User.updateOne(
        { _id: user._id },
        { passwordHash: await hashPassword(newPassword), mustChangePassword: false, failedLoginCount: 0, $unset: { lockUntil: 1 } }
    );
    await Session.updateMany(
        { user: user._id, _id: { $ne: keepSessionId }, revokedAt: { $exists: false } },
        { revokedAt: new Date() }
    );
}

// Retourne l'utilisateur d'une session valide (non expirée, non révoquée, compte actif) ou null.
async function findUserByToken(token) {
    if (!token) return null;
    const session = await Session.findOne({
        tokenHash: sha256(token), revokedAt: { $exists: false }, expiresAt: { $gt: new Date() }
    });
    if (!session) return null;
    const user = await User.findById(session.user);
    if (!user || !user.isActive) return null;
    return { user, session };
}

const revokeSession = (sessionId) => Session.updateOne({ _id: sessionId }, { revokedAt: new Date() });
const revokeAllSessions = (userId) =>
    Session.updateMany({ user: userId, revokedAt: { $exists: false } }, { revokedAt: new Date() });

module.exports = {
    createUser, login, changePassword, findUserByToken, revokeSession, revokeAllSessions,
    MAX_FAILED_LOGINS
};
