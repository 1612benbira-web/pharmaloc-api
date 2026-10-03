const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { createStaffBody } = require("../validators/authValidators");
const { createStaffUser } = require("../controllers/adminController");

const router = express.Router();
router.use(authenticate, requireRole("admin"));

router.post("/users", validate({ body: createStaffBody }), createStaffUser);

module.exports = router;
