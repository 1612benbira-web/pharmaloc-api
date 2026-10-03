const Shipment = require("../models/Shipment");
const Order = require("../models/Order");
const AppError = require("../utils/AppError");
const {
    canShipmentTransition, generateDeliveryCode, codeMatches,
    OPEN_STATUSES, MAX_CODE_ATTEMPTS, MAX_DELIVERY_ATTEMPTS
} = require("../domain/shipmentFlow");

// Passage d'état ATOMIQUE : ne réussit que si la course est encore dans l'état attendu
// (et, au besoin, au bon livreur). Deux requêtes concurrentes ne peuvent pas réussir toutes les deux.
async function move({ id, from, to, filter = {}, set = {}, unset = {} }) {
    if (!canShipmentTransition(from, to)) throw new Error(`Transition de course interdite : ${from} -> ${to}`);
    const update = { status: to, ...set };
    if (!OPEN_STATUSES.includes(to)) update.isOpen = false;
    if (Object.keys(unset).length) update.$unset = unset;
    return Shipment.findOneAndUpdate({ _id: id, status: from, ...filter }, update, { returnDocument: "after" });
}

// 404 si la course n'existe pas pour ce demandeur (on ne révèle rien), 409 si elle n'est pas dans le bon état.
async function rejectionFor(id, filter = {}) {
    return (await Shipment.exists({ _id: id, ...filter }))
        ? new AppError(409, "Cette course n'est pas dans l'état attendu pour cette action", "INVALID_SHIPMENT_STATE")
        : new AppError(404, "Course introuvable", "SHIPMENT_NOT_FOUND");
}

// Crée la course d'une commande de livraison prête. Idempotent : une course déjà ouverte est renvoyée.
async function createForOrder(order, attempt = 1) {
    try {
        return await Shipment.create({
            order: order._id, pharmacy: order.pharmacy,
            address: order.deliveryAddress, contactPhone: order.contactPhone,
            items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
            attempt, deliveryCode: generateDeliveryCode()
        });
    } catch (err) {
        if (err && err.code === 11000) return Shipment.findOne({ order: order._id, isOpen: true });
        throw err;
    }
}

// Le livreur prend une course disponible de SA pharmacie.
async function claim({ shipmentId, courier }) {
    const scope = { pharmacy: { $in: courier.pharmacies } };
    const shipment = await move({
        id: shipmentId, from: "PENDING", to: "ASSIGNED", filter: scope,
        set: { courier: courier._id, assignedAt: new Date() }
    });
    if (shipment) return shipment;
    throw (await Shipment.exists({ _id: shipmentId, ...scope }))
        ? new AppError(409, "Cette course n'est plus disponible", "SHIPMENT_NOT_AVAILABLE")
        : new AppError(404, "Course introuvable", "SHIPMENT_NOT_FOUND");
}

// Le livreur rend une course qu'il n'a pas encore récupérée : elle redevient disponible.
async function release({ shipmentId, courier }) {
    const mine = { courier: courier._id };
    const shipment = await move({
        id: shipmentId, from: "ASSIGNED", to: "PENDING", filter: mine, unset: { courier: 1, assignedAt: 1 }
    });
    if (!shipment) throw await rejectionFor(shipmentId, mine);
    return shipment;
}

// Le livreur récupère la commande à la pharmacie : la commande passe à OUT_FOR_DELIVERY.
async function pickup({ shipmentId, courier }) {
    const mine = { courier: courier._id };
    const shipment = await move({ id: shipmentId, from: "ASSIGNED", to: "PICKED_UP", filter: mine, set: { pickedUpAt: new Date() } });
    if (!shipment) throw await rejectionFor(shipmentId, mine);

    const order = await Order.findOneAndUpdate(
        { _id: shipment.order, status: "READY" }, { status: "OUT_FOR_DELIVERY" }, { returnDocument: "after" }
    );
    if (!order) {
        // La commande n'est pas (ou plus) prête : on annule la prise en charge.
        await Shipment.updateOne({ _id: shipment._id }, { status: "ASSIGNED", $unset: { pickedUpAt: 1 } });
        throw new AppError(409, "La commande n'est pas prête à être remise au livreur", "ORDER_NOT_READY");
    }
    return shipment;
}

// Remise au client : seul le code donné par le patient clôt la livraison.
async function deliver({ shipmentId, courier, code }) {
    const mine = { _id: shipmentId, courier: courier._id, status: "PICKED_UP" };

    // Chaque essai est compté de façon atomique, AVANT la comparaison : pas de contournement par requêtes parallèles.
    const shipment = await Shipment.findOneAndUpdate(
        { ...mine, codeAttempts: { $lt: MAX_CODE_ATTEMPTS } },
        { $inc: { codeAttempts: 1 } },
        { returnDocument: "after" }
    ).select("+deliveryCode");

    if (!shipment) {
        const current = await Shipment.findOne({ _id: shipmentId, courier: courier._id });
        if (!current) throw new AppError(404, "Course introuvable", "SHIPMENT_NOT_FOUND");
        if (current.status === "PICKED_UP") {
            throw new AppError(429, "Trop de codes erronés : signalez l'échec de la livraison", "TOO_MANY_CODE_ATTEMPTS");
        }
        throw new AppError(409, "Cette course n'est pas dans l'état attendu pour cette action", "INVALID_SHIPMENT_STATE");
    }

    if (!codeMatches(shipment.deliveryCode, code)) {
        throw new AppError(400, "Code de remise incorrect", "INVALID_DELIVERY_CODE", {
            attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - shipment.codeAttempts)
        });
    }

    const delivered = await move({
        id: shipment._id, from: "PICKED_UP", to: "DELIVERED", filter: { courier: courier._id }, set: { deliveredAt: new Date() }
    });
    if (!delivered) throw new AppError(409, "Cette course n'est pas dans l'état attendu pour cette action", "INVALID_SHIPMENT_STATE");

    await Order.findOneAndUpdate({ _id: shipment.order, status: "OUT_FOR_DELIVERY" }, { status: "COMPLETED" });
    return delivered;
}

// Échec de livraison (client injoignable...) : la commande redevient prête et une nouvelle course est proposée,
// dans la limite de MAX_DELIVERY_ATTEMPTS. Au-delà, la commande reste READY et la pharmacie doit intervenir.
async function fail({ shipmentId, courier, reason }) {
    const mine = { courier: courier._id };
    const failed = await move({
        id: shipmentId, from: "PICKED_UP", to: "FAILED", filter: mine, set: { failedAt: new Date(), failureReason: reason }
    });
    if (!failed) throw await rejectionFor(shipmentId, mine);

    const order = await Order.findOneAndUpdate(
        { _id: failed.order, status: "OUT_FOR_DELIVERY" }, { status: "READY" }, { returnDocument: "after" }
    );
    let next = null;
    if (order && failed.attempt < MAX_DELIVERY_ATTEMPTS) next = await createForOrder(order, failed.attempt + 1);
    return { shipment: failed, redispatched: Boolean(next) };
}

module.exports = { createForOrder, claim, release, pickup, deliver, fail };