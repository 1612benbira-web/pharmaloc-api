const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate } = require("../middlewares/auth");
const { auditAction } = require("../middlewares/audit");
const { registerBody, loginBody, changePasswordBody, forgotPasswordBody, resetPasswordBody } = require("../validators/authValidators");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { rateLimitEnabled } = require("../config/env");
const c = require("../controllers/authController");

// Limites propres à « mot de passe oublié » (par adresse IP, puis par adresse e-mail) : elles ne dépendent pas de
// l'existence du compte, donc ne révèlent rien. Désactivées pendant les tests, comme les autres limiteurs.
const passthrough = (req, res, next) => next();
const resetMessage = "Trop de demandes de réinitialisation : réessayez plus tard";
const emailKey = (req) => `${req.ip}|${String((req.body && req.body.email) || "").trim().toLowerCase().slice(0, 254)}`;
const forgotByIp = rateLimitEnabled
    ? createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10, code: "TOO_MANY_RESET_REQUESTS", message: resetMessage })
    : passthrough;
const forgotByEmail = rateLimitEnabled
    ? createRateLimiter({ windowMs: 60 * 60 * 1000, max: 3, key: emailKey, code: "TOO_MANY_RESET_REQUESTS", message: resetMessage })
    : passthrough;

const router = express.Router();

router.post("/register", validate({ body: registerBody }), c.register);
router.post("/login", validate({ body: loginBody }), c.login);
router.post("/logout", authenticate, c.logout);
router.post("/logout-all", authenticate, c.logoutAll);
router.post("/change-password", authenticate, validate({ body: changePasswordBody }),
    auditAction("PASSWORD_CHANGED", { target: (req) => String(req.user._id) }), c.changePassword);
router.post("/forgot-password", forgotByIp, forgotByEmail, validate({ body: forgotPasswordBody }), c.forgotPassword);
router.post("/reset-password", validate({ body: resetPasswordBody }), c.resetPassword);
router.get("/me", authenticate, c.me);

module.exports = router;
