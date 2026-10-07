const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { auditAction } = require("../middlewares/audit");
const { idParam } = require("../validators/common");
const { createStaffBody } = require("../validators/authValidators");
const { userListQuery, userStatusBody, auditListQuery } = require("../validators/adminValidators");
const { refundBody, paymentReviewQuery } = require("../validators/refundValidators");
const { createStaffUser, listUsers, setUserActive } = require("../controllers/adminController");
const { listPayments, refund } = require("../controllers/adminPaymentController");
const { listAudit } = require("../controllers/adminAuditController");

const router = express.Router();
router.use(authenticate, requireRole("admin"));

router.get("/users", validate({ query: userListQuery }), listUsers);
router.post("/users", validate({ body: createStaffBody }), createStaffUser); // journalisé dans le contrôleur
router.patch("/users/:id/status", validate({ params: idParam, body: userStatusBody }),
    auditAction((req) => (req.valid.body.isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED")), setUserActive);

router.get("/payments", validate({ query: paymentReviewQuery }), listPayments);
router.post("/payments/:id/refund", validate({ params: idParam, body: refundBody }),
    auditAction("PAYMENT_REFUNDED", { meta: (req) => ({ reason: req.valid.body.reason }), skip: (req, body) => Boolean(body && body.replayed) }),
    refund);

router.get("/audit", validate({ query: auditListQuery }), listAudit);

module.exports = router;
