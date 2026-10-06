const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const { createStaffBody } = require("../validators/authValidators");
const { userListQuery, userStatusBody } = require("../validators/adminValidators");
const { refundBody, paymentReviewQuery } = require("../validators/refundValidators");
const { createStaffUser, listUsers, setUserActive } = require("../controllers/adminController");
const { listPayments, refund } = require("../controllers/adminPaymentController");

const router = express.Router();
router.use(authenticate, requireRole("admin"));

router.get("/users", validate({ query: userListQuery }), listUsers);
router.post("/users", validate({ body: createStaffBody }), createStaffUser);
router.patch("/users/:id/status", validate({ params: idParam, body: userStatusBody }), setUserActive);

router.get("/payments", validate({ query: paymentReviewQuery }), listPayments);
router.post("/payments/:id/refund", validate({ params: idParam, body: refundBody }), refund);

module.exports = router;
