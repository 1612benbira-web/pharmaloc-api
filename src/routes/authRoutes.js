const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate } = require("../middlewares/auth");
const { registerBody, loginBody } = require("../validators/authValidators");
const c = require("../controllers/authController");

const router = express.Router();

router.post("/register", validate({ body: registerBody }), c.register);
router.post("/login", validate({ body: loginBody }), c.login);
router.post("/logout", authenticate, c.logout);
router.post("/logout-all", authenticate, c.logoutAll);
router.get("/me", authenticate, c.me);

module.exports = router;
