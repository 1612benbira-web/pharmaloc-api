const Payment = require("../models/Payment");
const AppError = require("../utils/AppError");
const paymentService = require("../services/paymentService");
const { idempotencyHeader } = require("../validators/stockValidators");

const createPayment = async (req, res) => {
    const key = idempotencyHeader.parse(req.get("Idempotency-Key"));
    const { orderId, method } = req.valid.body;
    const { payment, replayed } = await paymentService.startPayment({ user: req.user, orderId, method, idempotencyKey: key });
    res.status(replayed ? 200 : 201).json({
        message: replayed ? "Paiement déjà enregistré" : "Paiement initié",
        replayed,
        payment
    });
};

const getPayment = async (req, res) => {
    const payment = await Payment.findOne({ _id: req.valid.params.id, user: req.user._id });
    if (!payment) throw new AppError(404, "Paiement introuvable", "PAYMENT_NOT_FOUND");
    res.status(200).json(payment);
};

const respond = (res, result) =>
    res.status(200).json({
        message: result.replayed ? "Paiement déjà conclu" : "Paiement conclu",
        replayed: result.replayed,
        payment: result.payment,
        ...(result.order ? { order: result.order } : {})
    });

// Simulateur : remplace le webhook du prestataire. Jamais monté en production (voir paymentRoutes).
const simulatePayment = async (req, res) => {
    respond(res, await paymentService.settlePayment({ paymentId: req.valid.params.id, outcome: req.valid.body.outcome }));
};

// Simulateur de développement pour l'interface patient : le patient conclut LUI-MÊME le paiement ouvert
// de SA commande (jamais celui d'un autre). Jamais monté en production.
const simulateMyPayment = async (req, res) => {
    const payment = await Payment.findOne({ order: req.valid.params.orderId, user: req.user._id, isOpen: true });
    if (!payment) {
        throw new AppError(404, "Aucun paiement en cours pour cette commande : lancez d'abord le paiement", "PAYMENT_NOT_FOUND");
    }
    respond(res, await paymentService.settlePayment({ paymentId: payment._id, outcome: req.valid.body.outcome }));
};

module.exports = { createPayment, getPayment, simulatePayment, simulateMyPayment };
