const crypto = require("crypto");
const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const AppError = require("../utils/AppError");
const { movementDelta, OUT_TYPES, IN_TYPES } = require("../domain/stockMath");

// Types exigeant une justification écrite (traçabilité des corrections).
const REASON_REQUIRED = { ADJUSTMENT: 10, LOSS: 5, BREAKAGE: 5 };

/**
 * Applique un mouvement de stock de façon atomique et idempotente.
 *
 *  1. Réserver le mouvement (PENDING) : la clé d'idempotence est unique, donc un doublon
 *     ou une requête concurrente identique est détecté ici.
 *  2. Modifier la quantité avec un seul $inc conditionnel (sortie : quantity >= demandé).
 *     MongoDB rend l'opération atomique : deux ventes simultanées sur la dernière unité
 *     ne peuvent pas réussir toutes les deux.
 *  3. Marquer le mouvement APPLIED avec les quantités avant/après.
 *
 * `Stock.quantity` est le stock DISPONIBLE à la vente.
 * Limite connue : un arrêt du processus entre 2 et 3 laisse un mouvement PENDING alors que
 * le stock est modifié. C'est détectable ; une réconciliation reste à écrire.
 */
async function applyMovement({ stockId, type, quantity, direction, reason, idempotencyKey, delivery, performedBy }) {
    if (![...IN_TYPES, ...OUT_TYPES, "ADJUSTMENT"].includes(type)) {
        throw new AppError(400, "Type de mouvement non pris en charge", "UNSUPPORTED_MOVEMENT_TYPE");
    }
    const minReason = REASON_REQUIRED[type];
    if (minReason && (!reason || reason.trim().length < minReason)) {
        throw new AppError(400, `Une justification d'au moins ${minReason} caractères est obligatoire pour ce type d'opération`, "REASON_REQUIRED");
    }
    if (type === "ADJUSTMENT" && !["UP", "DOWN"].includes(direction)) {
        throw new AppError(400, "La direction (UP ou DOWN) est obligatoire pour un ajustement", "DIRECTION_REQUIRED");
    }

    const stockDoc = await Stock.findById(stockId).select("pharmacy medicine");
    if (!stockDoc) throw new AppError(404, "Stock introuvable", "STOCK_NOT_FOUND");

    const key = idempotencyKey || crypto.randomUUID();
    const delta = movementDelta(type, quantity, direction);

    let movement;
    try {
        movement = await StockMovement.create({
            stock: stockId, pharmacy: stockDoc.pharmacy, medicine: stockDoc.medicine,
            type, quantity, delta, reason, delivery, performedBy,
            idempotencyKey: key, status: "PENDING"
        });
    } catch (err) {
        if (err && err.code === 11000) return replayExisting(key, { stockId, type, delta });
        throw err;
    }

    const filter = { _id: stockId };
    if (delta < 0) filter.quantity = { $gte: -delta };

    const updated = await Stock.findOneAndUpdate(filter, { $inc: { quantity: delta } }, { returnDocument: "after" });

    if (!updated) {
        await StockMovement.updateOne({ _id: movement._id }, { status: "REJECTED", rejectionReason: "INSUFFICIENT_STOCK" });
        throw new AppError(409, "Stock insuffisant pour cette sortie", "INSUFFICIENT_STOCK");
    }

    movement.status = "APPLIED";
    movement.stockAfter = updated.quantity;
    movement.stockBefore = updated.quantity - delta;
    await movement.save();

    return { movement, stock: updated, replayed: false };
}

// Même clé déjà utilisée : on renvoie le résultat d'origine, sans rien réappliquer.
async function replayExisting(key, { stockId, type, delta }) {
    const existing = await StockMovement.findOne({ idempotencyKey: key });
    const samePayload =
        existing && String(existing.stock) === String(stockId) && existing.type === type && existing.delta === delta;

    if (!samePayload) {
        throw new AppError(409, "Cette clé d'idempotence a déjà servi pour une autre opération", "IDEMPOTENCY_CONFLICT");
    }
    if (existing.status === "PENDING") {
        throw new AppError(409, "Opération identique en cours de traitement", "OPERATION_IN_PROGRESS");
    }
    if (existing.status === "REJECTED") {
        throw new AppError(409, "Stock insuffisant pour cette sortie", "INSUFFICIENT_STOCK");
    }
    return { movement: existing, stock: await Stock.findById(stockId), replayed: true };
}

module.exports = { applyMovement, REASON_REQUIRED };
