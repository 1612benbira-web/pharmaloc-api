const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const { createStaffBody } = require("../validators/authValidators");
const { userListQuery, userStatusBody } = require("../validators/adminValidators");
const { createStaffUser, listUsers, setUserActive } = require("../controllers/adminController");

const router = express.Router();
router.use(authenticate, requireRole("admin"));

router.get("/users", validate({ query: userListQuery }), listUsers);
router.post("/users", validate({ body: createStaffBody }), createStaffUser);
router.patch("/users/:id/status", validate({ params: idParam, body: userStatusBody }), setUserActive);

module.exports = router;
