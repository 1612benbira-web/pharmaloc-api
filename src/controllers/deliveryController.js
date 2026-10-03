const Delivery = require("../models/Delivery");
const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const AppError = require("../utils/AppError");
const { applyMovement } = require("../services/stockService");
const { receiveIntoLot, assertLotReceivable } = require("../services/lotService");
const { assertReceivable, registerReceipt } = require("../services/purchaseOrderService");
const { assertPharmacyAccess, canAccessPharmacy } = require("../services/accessService");
const { idempotencyHeader } = require("../validators/stockValidators");
const { pagination } = require("../validators/common");

const populated = (id) => Delivery.findById(id).populate("pharmacy").populate("medicine");

const createDelivery = async (req, res) => {
    const key = idempotencyHeader.parse(req.get("Idempotency-Key"));
    const b = req.valid.body;
    assertPharmacyAccess(req.user, b.pharmacy);

    // Même clé = même livraison : on renvoie l'existante sans toucher au stock.
    if (key) {
        const existing = await Delivery.findOne({ idempotencyKey: key });
        if (existing) return replay(req, res, existing);
    }

    const stock = await Stock.findOne({ pharmacy: b.pharmacy, medicine: b.medicine });
    if (!stock) throw new AppError(404, "Stock introuvable pour cette pharmacie et ce médicament", "STOCK_NOT_FOUND");

    // Toutes les vérifications AVANT de modifier quoi que ce soit.
    if (b.lotNumber) await assertLotReceivable({ stockId: stock._id, lotNumber: b.lotNumber, expiryDate: b.expiryDate });
    if (b.purchaseOrder) await assertReceivable({ orderId: b.purchaseOrder, pharmacyId: b.pharmacy, stockId: stock._id });

    let delivery;
    try {
        delivery = await Delivery.create({
            pharmacy: b.pharmacy, medicine: b.medicine, quantity: b.quantity, supplier: b.supplier,
            reference: b.reference, deliveryDate: b.deliveryDate, lotNumber: b.lotNumber, expiryDate: b.expiryDate,
            unitPrice: b.unitPrice, purchaseOrder: b.purchaseOrder, ...(key ? { idempotencyKey: key } : {})
        });
    } catch (err) {
        // Requête identique arrivée en parallèle : on renvoie celle qui a gagné.
        if (err && err.code === 11000 && key) return replay(req, res, await Delivery.findOne({ idempotencyKey: key }));
        throw err;
    }

    let result;
    try {
        result = await applyMovement({
            stockId: stock._id, type: "IN", quantity: b.quantity, reason: "Livraison",
            idempotencyKey: `delivery:${delivery._id}`, delivery: delivery._id, performedBy: req.user._id
        });
    } catch (err) {
        await Delivery.updateOne({ _id: delivery._id }, { status: "FAILED" });
        throw err;
    }

    let lot;
    if (b.lotNumber) {
        lot = await receiveIntoLot({ stock, lotNumber: b.lotNumber, expiryDate: b.expiryDate, quantity: b.quantity, supplier: b.supplier });
        const allocations = [{ lot: lot._id, quantity: b.quantity }];
        await StockMovement.updateOne({ _id: result.movement._id }, { allocations });
        result.movement.allocations = allocations; // la réponse reflète ce qui est enregistré
    }

    let order;
    if (b.purchaseOrder) {
        order = await registerReceipt({ orderId: b.purchaseOrder, stockId: stock._id, quantity: b.quantity });
    }

    res.status(201).json({
        message: "Livraison enregistrée et stock mis à jour avec succès",
        delivery: await populated(delivery._id),
        stock: { id: stock._id, quantityBefore: result.movement.stockBefore, quantityAfter: result.movement.stockAfter },
        movement: result.movement,
        ...(lot ? { lot: { id: lot._id, lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, remainingQuantity: lot.remainingQuantity } } : {}),
        ...(order ? { purchaseOrder: { id: order.order._id, status: order.order.status, overDelivery: order.overDelivery } } : {})
    });
};

async function replay(req, res, delivery) {
    // Une clé ne doit pas permettre de lire la livraison d'une autre pharmacie.
    if (!canAccessPharmacy(req.user, delivery.pharmacy)) {
        throw new AppError(409, "Cette clé d'idempotence a déjà servi pour une autre opération", "IDEMPOTENCY_CONFLICT");
    }
    res.status(200).json({ message: "Livraison déjà enregistrée", replayed: true, delivery: await populated(delivery._id) });
}

const getDeliveries = async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const scope = { pharmacy: { $in: req.user.pharmacies } };
    const [deliveries, total] = await Promise.all([
        Delivery.find(scope).populate("pharmacy").populate("medicine")
            .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        Delivery.countDocuments(scope)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(deliveries);
};

module.exports = { createDelivery, getDeliveries };
