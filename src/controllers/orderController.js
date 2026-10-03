const Order = require("../models/Order");
const AppError = require("../utils/AppError");
const orderService = require("../services/orderService");
const { canAccessPharmacy, STAFF_ROLES } = require("../services/accessService");
const { idempotencyHeader } = require("../validators/stockValidators");

// Express 5 transmet automatiquement les erreurs async à errorHandler : pas de try/catch.

async function listOrders(res, scope, { page, limit }) {
    const [orders, total] = await Promise.all([
        Order.find(scope).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        Order.countDocuments(scope)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(orders);
}

const createOrder = async (req, res) => {
    const key = idempotencyHeader.parse(req.get("Idempotency-Key"));
    const { order, replayed } = await orderService.createOrder({ user: req.user, body: req.valid.body, idempotencyKey: key });
    res.status(replayed ? 200 : 201).json({
        message: replayed ? "Commande déjà enregistrée" : "Commande créée : stock réservé, paiement attendu",
        replayed,
        order
    });
};

const getMyOrders = async (req, res) => {
    const { status, ...paging } = req.valid.query;
    await orderService.expireOverdueOrders({ user: req.user._id });
    await listOrders(res, { user: req.user._id, ...(status ? { status } : {}) }, paging);
};

const getPharmacyOrders = async (req, res) => {
    const { status, ...paging } = req.valid.query;
    await listOrders(res, { pharmacy: { $in: req.user.pharmacies }, ...(status ? { status } : {}) }, paging);
};

const getOrder = async (req, res) => {
    const id = req.valid.params.id;
    await orderService.expireOverdueOrders({ _id: id });
    const order = await Order.findById(id);

    const isOwner = order && String(order.user) === String(req.user._id);
    const isStaff = order && STAFF_ROLES.includes(req.user.role) && canAccessPharmacy(req.user, order.pharmacy);
    // 404 et non 403 : on ne révèle pas l'existence d'une commande d'un autre patient.
    if (!order || !(isOwner || isStaff)) throw new AppError(404, "Commande introuvable", "ORDER_NOT_FOUND");
    res.status(200).json(order);
};

const cancelOrder = async (req, res) => {
    const order = await orderService.cancelOrder({ orderId: req.valid.params.id, user: req.user });
    res.status(200).json({ message: "Commande annulée, stock remis en vente", order });
};

const updateOrderStatus = async (req, res) => {
    const order = await orderService.updateStatus({ orderId: req.valid.params.id, user: req.user, to: req.valid.body.status });
    res.status(200).json({ message: "Statut mis à jour", order });
};

module.exports = { createOrder, getMyOrders, getPharmacyOrders, getOrder, cancelOrder, updateOrderStatus };