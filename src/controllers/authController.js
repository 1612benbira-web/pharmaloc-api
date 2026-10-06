const authService = require("../services/authService");
const { COOKIE_NAME } = require("../middlewares/auth");
const { isProduction } = require("../config/env");

const cookieOptions = (maxAge) => ({
    httpOnly: true,            // inaccessible au JavaScript de la page (limite le vol par XSS)
    sameSite: "lax",           // limite le CSRF
    secure: isProduction,      // HTTPS uniquement en production
    path: "/",
    ...(maxAge ? { maxAge } : {})
});

const publicUser = (u) => ({
    id: u._id, name: u.name, email: u.email, role: u.role, pharmacies: u.pharmacies,
    mustChangePassword: Boolean(u.mustChangePassword)
});

const register = async (req, res) => {
    const { name, email, password } = req.valid.body;
    const user = await authService.createUser({ name, email, password, role: "patient" });
    res.status(201).json({ message: "Compte créé", user: publicUser(user) });
};

const login = async (req, res) => {
    const { email, password } = req.valid.body;
    const { user, token, maxAgeMs } = await authService.login(email, password, req.get("User-Agent"));
    res.cookie(COOKIE_NAME, token, cookieOptions(maxAgeMs));
    res.status(200).json({ message: "Connexion réussie", user: publicUser(user) });
};

const logout = async (req, res) => {
    await authService.revokeSession(req.session._id);
    res.clearCookie(COOKIE_NAME, cookieOptions());
    res.status(200).json({ message: "Déconnexion réussie" });
};

const logoutAll = async (req, res) => {
    await authService.revokeAllSessions(req.user._id);
    res.clearCookie(COOKIE_NAME, cookieOptions());
    res.status(200).json({ message: "Toutes les sessions ont été révoquées" });
};

const changePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body;
    await authService.changePassword({
        userId: req.user._id, currentPassword, newPassword, keepSessionId: req.session._id
    });
    res.status(200).json({ message: "Mot de passe modifié. Vos autres appareils ont été déconnectés." });
};

const me = (req, res) => res.status(200).json({ user: publicUser(req.user) });

module.exports = { register, login, logout, logoutAll, changePassword, me };
