const Payment = require("../models/Payment");
const { refundPayment } = require("../services/paymentService");

const view = (p) => ({
    id: p._id,
    orderId: p.order && p.order._id ? p.order._id : p.order,
    orderStatus: p.order && p.order.status,
    amount: p.amount, currency: p.currency, method: p.method, status: p.status,
    transactionId: p.transactionId, needsReview: Boolean(p.needsReview),
    paidAt: p.paidAt, refundedAt: p.refundedAt, refundReason: p.refundReason, createdAt: p.createdAt
});

// Paiements à traiter par défaut (commande expirée ou annulée) ; needsReview=false liste tous les paiements.
const listPayments = async (req, res) => {
    const { needsReview, page, limit } = req.valid.query;
    const filter = needsReview ? { needsReview: true } : {};
    const [payments, total] = await Promise.all([
        Payment.find(filter).populate("order", "status total fulfillment").sort({ createdAt: -1 })
            .skip((page - 1) * limit).limit(limit).lean(),
        Payment.countDocuments(filter)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(payments.map(view));
};

const refund = async (req, res) => {
    const { payment, replayed } = await refundPayment({ paymentId: req.valid.params.id, reason: req.valid.body.reason });
    res.status(200).json({
        message: replayed ? "Paiement déjà remboursé" : "Paiement remboursé",
        replayed,
        payment: view(payment.toObject())
    });
};

module.exports = { listPayments, refund };
