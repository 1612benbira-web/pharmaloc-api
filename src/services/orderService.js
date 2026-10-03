const Order = require("../models/Order");
const Payment = require("../models/Payment");
const Stock = require("../models/Stock");
const Pharmacy = require("../models/Pharmacy");
const Medicine = require("../models/Medicine");
const Lot = require("../models/Lot");
const StockMovement = require("../models/StockMovement");
const AppError = require("../utils/AppError");
const { recordMovement } = require("./lotService");
const { applyMovement } = require("./stockService");
const { canAccessPharmacy } = require("./accessService");
const shipmentService = require("./shipmentService");
const { computeTotals, canTransition, managedByShipment } = require("../domain/orderFlow");

const DELIVERY_FEE = 750; // FCFA, fixe pour l'instant
const RESERVATION_TTL_MS = 30 * 60 * 1000;

const reserveKey = (orderId, stockId) => `order:${orderId}:${stockId}`;
const releaseKey = (orderId, stockId) => `order-release:${orderId}:${stockId}`;

// Construit les lignes de commande à partir de la BASE (nom, prix) : jamais à partir de ce que dit le client.
async function buildLines(pharmacyId, items) {
    if (!(await Pharmacy.exists({ _id: pharmacyId, isActive: true }))) {
        throw new AppError(404, "Pharmacie introuvable", "PHARMACY_NOT_FOUND");
    }
    const ids = items.map((i) => i.medicine);
    const [medicines, stocks] = await Promise.all([
        Medicine.find({ _id: { $in: ids }, isActive: { $ne: false } }),
        Stock.find({ pharmacy: pharmacyId, medicine: { $in: ids } })
    ]);

    return items.map((i) => {
        const medicine = medicines.find((m) => String(m._id) === i.medicine);
        if (!medicine) throw new AppError(404, "Médicament introuvable", "MEDICINE_NOT_FOUND");
        if (medicine.prescriptionRequired) {
            throw new AppError(400, `${medicine.name} nécessite une ordonnance : commande en ligne impossible pour l'instant`, "PRESCRIPTION_REQUIRED");
        }
        const stock = stocks.find((s) => String(s.medicine) === i.medicine);
        if (!stock) throw new AppError(404, `${medicine.name} n'est pas proposé par cette pharmacie`, "NOT_STOCKED");
        if (typeof stock.price !== "number") {
            throw new AppError(409, `Le prix de ${medicine.name} n'est pas renseigné dans cette pharmacie`, "PRICE_NOT_SET");
        }
        return { stock: stock._id, medicine: medicine._id, name: medicine.name, unitPrice: stock.price, quantity: i.quantity };
    });
}

function replayOrder(existing, user) {
    if (String(existing.user) !== String(user._id)) {
        throw new AppError(409, "Cette clé d'idempotence a déjà servi pour une autre opération", "IDEMPOTENCY_CONFLICT");
    }
    if (!existing.stockReserved) {
        throw new AppError(409, "Opération identique en cours de traitement", "OPERATION_IN_PROGRESS");
    }
    return { order: existing, replayed: true };
}

async function reserveLine(order, line, user) {
    try {
        // recordMovement : constate les péremptions, retire du stock disponible ET des lots (FEFO).
        await recordMovement({
            stockId: line.stock, type: "OUT", quantity: line.quantity, reason: `Commande ${order._id}`,
            idempotencyKey: reserveKey(order._id, line.stock), performedBy: user._id
        });
    } catch (err) {
        if (err && err.code === "INSUFFICIENT_STOCK") {
            throw new AppError(409, `Stock insuffisant pour ${line.name}`, "INSUFFICIENT_STOCK", { medicine: String(line.medicine) });
        }
        throw err;
    }
}

/**
 * Remet en vente le stock réservé par une commande. À n'appeler qu'UNE fois par commande
 * (l'appelant "revendique" d'abord le changement de statut de façon atomique).
 *  - lot encore vendable : unités rendues au lot ET au stock disponible ;
 *  - lot en quarantaine : unités rendues au lot seulement (elles reviendront à la libération du lot) ;
 *  - lot périmé : unités non remises en vente ;
 *  - unités vendues "sans lot" : rendues au stock.
 * Limite connue (comme pour tes mouvements) : un arrêt du processus entre la mise à jour des lots
 * et le mouvement de retour laisse un écart détectable ; une réconciliation reste à écrire.
 */
async function releaseOrderStock(order, performedBy, now = new Date()) {
    for (const item of order.items) {
        const movement = await StockMovement.findOne({ idempotencyKey: reserveKey(order._id, item.stock), status: "APPLIED" });
        if (!movement) continue; // cette ligne n'a jamais été réservée

        const allocations = movement.allocations || [];
        let restorable = item.quantity - allocations.reduce((s, a) => s + a.quantity, 0);

        for (const a of allocations) {
            const back = await Lot.updateOne(
                { _id: a.lot, state: "OK", expiryDate: { $gt: now } },
                { $inc: { remainingQuantity: a.quantity } }
            );
            if (back.modifiedCount === 1) {
                restorable += a.quantity;
            } else {
                await Lot.updateOne({ _id: a.lot, state: "QUARANTINE" }, { $inc: { remainingQuantity: a.quantity } });
            }
        }

        if (restorable > 0) {
            await applyMovement({
                stockId: item.stock, type: "RETURN", quantity: restorable, reason: `Annulation commande ${order._id}`,
                idempotencyKey: releaseKey(order._id, item.stock), performedBy
            });
        }
    }
}

async function createOrder({ user, body, idempotencyKey }) {
    const { pharmacy, items, fulfillment, deliveryAddress, contactPhone } = body;

    if (idempotencyKey) {
        const existing = await Order.findOne({ idempotencyKey });
        if (existing) return replayOrder(existing, user);
    }

    const lines = await buildLines(pharmacy, items);
    const totals = computeTotals(lines, fulfillment, DELIVERY_FEE);

    // La commande est créée AVANT la réservation : la clé d'idempotence (index unique) écarte les doublons parallèles.
    let order;
    try {
        order = await Order.create({
            user: user._id, pharmacy, items: lines, fulfillment,
            ...(fulfillment === "DELIVERY" ? { deliveryAddress, contactPhone } : {}),
            ...totals,
            reservationExpiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
            ...(idempotencyKey ? { idempotencyKey } : {})
        });
    } catch (err) {
        if (err && err.code === 11000 && idempotencyKey) {
            return replayOrder(await Order.findOne({ idempotencyKey }), user);
        }
        throw err;
    }

    try {
        for (const line of lines) await reserveLine(order, line, user);
    } catch (err) {
        // Une ligne a échoué : on rend ce qui avait été réservé et on supprime la commande.
        await releaseOrderStock(order, user._id);
        await Order.deleteOne({ _id: order._id });
        throw err;
    }

    await Order.updateOne({ _id: order._id }, { stockReserved: true });
    order.stockReserved = true;
    return { order, replayed: false };
}

// Annulation par le patient, tant que la commande n'est pas payée.
async function cancelOrder({ orderId, user }) {
    if (await Payment.exists({ order: orderId, isOpen: true })) {
        throw new AppError(409, "Un paiement est en cours ou réglé pour cette commande", "PAYMENT_IN_PROGRESS");
    }
    const claimed = await Order.findOneAndUpdate(
        { _id: orderId, user: user._id, status: "PAYMENT_PENDING" },
        { status: "CANCELLED" },
        { returnDocument: "after" }
    );
    if (!claimed) {
        throw (await Order.exists({ _id: orderId, user: user._id }))
            ? new AppError(409, "Cette commande ne peut plus être annulée", "ORDER_NOT_CANCELLABLE")
            : new AppError(404, "Commande introuvable", "ORDER_NOT_FOUND");
    }
    await releaseOrderStock(claimed, user._id);
    return claimed;
}

/**
 * Fait expirer les commandes non payées dont le délai est dépassé et remet leur stock en vente.
 * Sans planificateur : appelé quand on lit les commandes ou qu'on démarre un paiement.
 * Une commande avec un paiement en cours n'expire pas : on attend sa conclusion.
 */
async function expireOverdueOrders(filter = {}, now = new Date()) {
    const overdue = await Order.find({ ...filter, status: "PAYMENT_PENDING", reservationExpiresAt: { $lte: now } }).limit(50);
    let expired = 0;
    for (const o of overdue) {
        if (await Payment.exists({ order: o._id, isOpen: true })) continue;
        const claimed = await Order.findOneAndUpdate(
            { _id: o._id, status: "PAYMENT_PENDING" },
            { status: "EXPIRED" },
            { returnDocument: "after" }
        );
        if (claimed) {
            await releaseOrderStock(claimed, undefined, now);
            expired++;
        }
    }
    return expired;
}

// Avancement de la commande par le personnel de la pharmacie concernée.
async function updateStatus({ orderId, user, to }) {
    const order = await Order.findById(orderId);
    if (!order || !canAccessPharmacy(user, order.pharmacy)) {
        throw new AppError(404, "Commande introuvable", "ORDER_NOT_FOUND");
    }
    if (!canTransition(order.status, to, order.fulfillment)) {
        throw new AppError(409, `Passage de ${order.status} à ${to} impossible pour cette commande`, "INVALID_TRANSITION");
    }
    if (managedByShipment(order.fulfillment, to)) {
        throw new AppError(409, "Pour une livraison à domicile, la remise et la livraison sont gérées par le livreur", "MANAGED_BY_SHIPMENT");
    }
    const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: order.status },
        { status: to },
        { returnDocument: "after" }
    );
    if (!updated) throw new AppError(409, "La commande vient d'être modifiée : réessayez", "ORDER_CHANGED");

    // Commande de livraison prête : elle devient disponible pour les livreurs de la pharmacie.
    // (idempotent : une course déjà ouverte pour cette commande est simplement renvoyée)
    if (to === "READY" && updated.fulfillment === "DELIVERY") {
        await shipmentService.createForOrder(updated);
    }
    return updated;
}

module.exports = { createOrder, cancelOrder, expireOverdueOrders, updateStatus, releaseOrderStock, DELIVERY_FEE };