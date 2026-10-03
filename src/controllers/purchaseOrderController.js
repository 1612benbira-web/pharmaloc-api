const PurchaseOrder = require("../models/PurchaseOrder");
const AppError = require("../utils/AppError");
const { assertPharmacyAccess, canAccessPharmacy } = require("../services/accessService");
const { pharmacyScope } = require("../services/scopeService");
const svc = require("../services/purchaseOrderService");

async function loadAccessibleOrder(user, id) {
    const order = await PurchaseOrder.findById(id);
    if (!order || !canAccessPharmacy(user, order.pharmacy)) throw new AppError(404, "Commande introuvable", "ORDER_NOT_FOUND");
    return order;
}

const createOrder = async (req, res) => {
    const b = req.valid.body;
    assertPharmacyAccess(req.user, b.pharmacy);
    const order = await svc.createDraft({
        pharmacyId: b.pharmacy, supplierId: b.supplier, lines: b.lines,
        expectedDate: b.expectedDate, notes: b.notes, createdBy: req.user._id
    });
    res.status(201).json({ message: "Brouillon de commande créé. Le stock n'est pas modifié par une commande.", order });
};

const createFromSuggestions = async (req, res) => {
    const b = req.valid.body;
    assertPharmacyAccess(req.user, b.pharmacy);
    const order = await svc.createDraftFromSuggestions({
        pharmacyId: b.pharmacy, supplierId: b.supplier, stockIds: b.stockIds,
        expectedDate: b.expectedDate, createdBy: req.user._id
    });
    res.status(201).json({ message: "Brouillon généré depuis les suggestions. À vérifier avant validation.", order });
};

const listOrders = async (req, res) => {
    const { page, limit, pharmacy, status } = req.valid.query;
    const filter = { pharmacy: { $in: pharmacyScope(req.user, pharmacy) }, ...(status ? { status } : {}) };
    const [orders, total] = await Promise.all([
        PurchaseOrder.find(filter).populate("supplier", "name").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        PurchaseOrder.countDocuments(filter)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(orders);
};

const getOrder = async (req, res) => {
    const order = await loadAccessibleOrder(req.user, req.valid.params.id);
    res.status(200).json(await order.populate([{ path: "supplier", select: "name phone email" }, { path: "lines.medicine", select: "name dosage form" }]));
};

const transitionOrder = async (req, res) => {
    const order = await loadAccessibleOrder(req.user, req.valid.params.id);
    const updated = await svc.transition({ order, to: req.valid.body.to, user: req.user, reason: req.valid.body.reason });
    res.status(200).json({ message: `Commande : ${updated.status}`, order: updated });
};

module.exports = { createOrder, createFromSuggestions, listOrders, getOrder, transitionOrder };
