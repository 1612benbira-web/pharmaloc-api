const Order = require("../models/Order");
const Payment = require("../models/Payment");
const AppError = require("../utils/AppError");
const { getProvider } = require("./paymentProviders");
const { expireOverdueOrders } = require("./orderService");

function replayPayment(existing, user, orderId) {
    if (String(existing.user) !== String(user._id) || String(existing.order) !== String(orderId)) {
        throw new AppError(409, "Cette clé d'idempotence a déjà servi pour une autre opération", "IDEMPOTENCY_CONFLICT");
    }
    return { payment: existing, replayed: true };
}

async function startPayment({ user, orderId, method, idempotencyKey }) {
    if (idempotencyKey) {
        const existing = await Payment.findOne({ idempotencyKey });
        if (existing) return replayPayment(existing, user, orderId);
    }

    // Une commande dont le délai est dépassé expire avant de pouvoir être payée.
    await expireOverdueOrders({ _id: orderId });

    const order = await Order.findOne({ _id: orderId, user: user._id });
    if (!order) throw new AppError(404, "Commande introuvable", "ORDER_NOT_FOUND");
    if (order.status === "EXPIRED") throw new AppError(409, "Le délai de paiement de cette commande est dépassé", "ORDER_EXPIRED");
    if (order.status !== "PAYMENT_PENDING" || !order.stockReserved) {
        throw new AppError(409, "Cette commande ne peut pas être payée", "ORDER_NOT_PAYABLE");
    }

    const provider = getProvider(method);

    // Le paiement est créé AVANT l'appel au prestataire : l'index unique partiel écarte un second paiement ouvert.
    let payment;
    try {
        payment = await Payment.create({
            order: order._id, user: user._id,
            amount: order.total, // le montant vient de la commande, jamais du client
            currency: order.currency, method, status: "PENDING",
            ...(idempotencyKey ? { idempotencyKey } : {})
        });
    } catch (err) {
        if (err && err.code === 11000) {
            if (idempotencyKey) {
                const existing = await Payment.findOne({ idempotencyKey });
                if (existing) return replayPayment(existing, user, orderId);
            }
            throw new AppError(409, "Un paiement est déjà en cours ou réglé pour cette commande", "PAYMENT_ALREADY_STARTED");
        }
        throw err;
    }

    try {
        const result = await provider.initiate({ orderId: order._id, amount: order.total, currency: order.currency, method });
        payment = await Payment.findByIdAndUpdate(
            payment._id, { status: result.status, transactionId: result.transactionId }, { returnDocument: "after" }
        );
    } catch (err) {
        await Payment.updateOne({ _id: payment._id }, { status: "FAILED", isOpen: false });
        throw err;
    }
    return { payment, replayed: false };
}

/**
 * Conclut un paiement (appelé par le simulateur aujourd'hui, par le webhook du prestataire demain).
 * Le passage de l'état "ouvert" à l'état final est atomique : un résultat rejoué ne change rien.
 * Pour un vrai webhook : vérifier la signature du prestataire et comparer le montant à payment.amount.
 */
async function settlePayment({ paymentId, outcome }) {
    const update = outcome === "PAID"
        ? { status: "PAID", paidAt: new Date() }
        : { status: "FAILED", isOpen: false };

    const claimed = await Payment.findOneAndUpdate(
        { _id: paymentId, status: { $in: ["PENDING", "PROCESSING"] } },
        update,
        { returnDocument: "after" }
    );
    if (!claimed) {
        const existing = await Payment.findById(paymentId);
        if (!existing) throw new AppError(404, "Paiement introuvable", "PAYMENT_NOT_FOUND");
        return { payment: existing, replayed: true };
    }

    if (outcome !== "PAID") return { payment: claimed, replayed: false };

    const order = await Order.findOneAndUpdate(
        { _id: claimed.order, status: "PAYMENT_PENDING" },
        { status: "CONFIRMED" },
        { returnDocument: "after" }
    );
    if (!order) {
        // L'argent est arrivé mais la commande n'est plus payable (expirée ou annulée entre-temps) : à rembourser.
        await Payment.updateOne({ _id: claimed._id }, { needsReview: true });
        claimed.needsReview = true;
    }
    return { payment: claimed, order, replayed: false };
}

/**
 * Rembourse un paiement réglé dont la commande est annulée ou expirée.
 *  1. Le remboursement est "réservé" de façon atomique (refundRequestedAt) : deux demandes simultanées ne
 *     peuvent pas toutes deux appeler le prestataire.
 *  2. Le prestataire rembourse (avec une clé d'idempotence stable, pour ne jamais rembourser deux fois).
 *  3. Le paiement passe à REFUNDED. Si le prestataire échoue, la réservation est levée et on peut réessayer.
 * Limite connue : un arrêt brutal entre 2 et 3 laisse refundRequestedAt posé sans REFUNDED (détectable, à réconcilier).
 */
async function refundPayment({ paymentId, reason }) {
    const existing = await Payment.findById(paymentId);
    if (!existing) throw new AppError(404, "Paiement introuvable", "PAYMENT_NOT_FOUND");
    if (existing.status === "REFUNDED") return { payment: existing, replayed: true };
    if (existing.status !== "PAID") {
        throw new AppError(409, "Seul un paiement réglé peut être remboursé", "PAYMENT_NOT_REFUNDABLE");
    }

    const order = await Order.findById(existing.order);
    if (!order || !["EXPIRED", "CANCELLED"].includes(order.status)) {
        throw new AppError(409, "La commande est encore active : annulez-la d'abord pour pouvoir rembourser", "ORDER_STILL_ACTIVE");
    }

    const provider = getProvider(existing.method); // 501 en production tant qu'aucun prestataire n'est configuré

    const claimed = await Payment.findOneAndUpdate(
        { _id: paymentId, status: "PAID", refundRequestedAt: { $exists: false } },
        { refundRequestedAt: new Date(), refundReason: reason },
        { returnDocument: "after" }
    );
    if (!claimed) throw new AppError(409, "Un remboursement est déjà en cours pour ce paiement", "REFUND_IN_PROGRESS");

    let result;
    try {
        result = await provider.refund({
            transactionId: claimed.transactionId, amount: claimed.amount, currency: claimed.currency,
            idempotencyKey: `refund:${claimed._id}`
        });
    } catch (err) {
        await Payment.updateOne({ _id: claimed._id }, { $unset: { refundRequestedAt: 1, refundReason: 1 } });
        throw err;
    }

    const refunded = await Payment.findOneAndUpdate(
        { _id: claimed._id },
        { status: "REFUNDED", isOpen: false, needsReview: false, refundedAt: new Date(), refundTransactionId: result.refundTransactionId },
        { returnDocument: "after" }
    );
    return { payment: refunded, replayed: false };
}

module.exports = { startPayment, settlePayment, refundPayment };
