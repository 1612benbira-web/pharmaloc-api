const crypto = require("crypto");
const Lot = require("../models/Lot");
const Stock = require("../models/Stock");
const StockMovement = require("../models/StockMovement");
const AppError = require("../utils/AppError");
const { planFEFO } = require("../domain/stockMath");
const { applyMovement } = require("./stockService");

const MAX_ALLOCATION_ATTEMPTS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Si un autre processus applique déjà ce même mouvement (clé identique), on attend brièvement son résultat
// au lieu d'échouer : il ne faut JAMAIS vendre avant que la péremption soit réellement déduite du stock.
async function applyWhenSettled(params, attempts = 20, delayMs = 50) {
    for (let i = 0; ; i++) {
        try {
            return await applyMovement(params);
        } catch (err) {
            if (err.code !== "OPERATION_IN_PROGRESS" || i >= attempts) throw err;
            await sleep(delayMs);
        }
    }
}

/**
 * Réception d'une quantité dans un lot (créé au besoin). Appelé APRÈS l'entrée en stock.
 * Un lot en quarantaine ou périmé ne peut pas recevoir de nouvelles unités (vérifié avant par assertLotReceivable).
 */
async function receiveIntoLot({ stock, lotNumber, expiryDate, quantity, supplier, now = new Date() }) {
    const run = () => Lot.findOneAndUpdate(
        { stock: stock._id, lotNumber, expiryDate },
        {
            $inc: { receivedQuantity: quantity, remainingQuantity: quantity },
            $setOnInsert: { pharmacy: stock.pharmacy, medicine: stock.medicine, supplier, receivedAt: now, state: "OK" }
        },
        { upsert: true, returnDocument: "after" }
    );
    try {
        return await run();
    } catch (err) {
        // Deux réceptions simultanées d'un nouveau lot : l'une crée, l'autre doit simplement incrémenter.
        if (err && err.code === 11000) return run();
        throw err;
    }
}

// À appeler AVANT de toucher au stock : refuse un produit périmé ou un lot déjà bloqué.
async function assertLotReceivable({ stockId, lotNumber, expiryDate, now = new Date() }) {
    if (new Date(expiryDate) <= now) {
        throw new AppError(400, "Ce produit est déjà périmé : la réception est refusée", "LOT_EXPIRED");
    }
    const existing = await Lot.findOne({ stock: stockId, lotNumber, expiryDate });
    if (existing && existing.state !== "OK") {
        throw new AppError(409, "Ce lot est en quarantaine ou périmé : la réception ne peut pas l'alimenter", "LOT_NOT_ACTIVE");
    }
}

/**
 * Constate les péremptions : retire du stock DISPONIBLE les unités des lots échus, puis marque le lot EXPIRED.
 * Idempotent (clé `expiry:<lot>`) et sans planificateur : appelé avant chaque sortie et avant chaque évaluation d'alertes.
 */
async function sweepExpiredLots({ stockId, pharmacyId, now = new Date() }) {
    const filter = { state: "OK", expiryDate: { $lte: now } };
    if (stockId) filter.stock = stockId;
    if (pharmacyId) filter.pharmacy = pharmacyId;

    const lots = await Lot.find(filter).limit(200);
    let swept = 0;
    for (const lot of lots) {
        let needsReview = false;
        if (lot.remainingQuantity > 0) {
            try {
                await applyWhenSettled({
                    stockId: lot.stock, type: "EXPIRY", quantity: lot.remainingQuantity,
                    reason: `Lot ${lot.lotNumber} périmé`, idempotencyKey: `expiry:${lot._id}`
                });
                await StockMovement.updateOne({ idempotencyKey: `expiry:${lot._id}` }, { allocations: [{ lot: lot._id, quantity: lot.remainingQuantity }] });
            } catch (err) {
                // Stock disponible < unités du lot : incohérence. On bloque le lot et on le signale, sans rien inventer.
                if (err.code !== "INSUFFICIENT_STOCK") throw err;
                needsReview = true;
            }
        }
        const r = await Lot.updateOne(
            { _id: lot._id, state: "OK" },
            { state: "EXPIRED", stateChangedAt: now, stateReason: "Péremption constatée", needsReview }
        );
        swept += r.modifiedCount;
    }
    return swept;
}

/**
 * FEFO : décrémente les lots vendables, le plus proche de la péremption d'abord.
 * Chaque décrément est atomique et conditionnel (le lot doit encore être OK, non périmé, avec assez d'unités).
 * Ce qui ne vient d'aucun lot vendable est pris sur le stock "sans lot".
 */
async function allocateFromLots(stockId, quantity, now = new Date()) {
    let need = quantity;
    const taken = new Map();

    for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS && need > 0; attempt++) {
        const lots = await Lot.find({
            stock: stockId, state: "OK", expiryDate: { $gt: now }, remainingQuantity: { $gt: 0 }
        }).sort({ expiryDate: 1, lotNumber: 1 }).limit(50).lean();
        if (lots.length === 0) break;

        const plan = planFEFO(lots, need, now);
        let conflicts = 0;
        for (const a of plan.allocations) {
            const r = await Lot.updateOne(
                { _id: a.lot, state: "OK", expiryDate: { $gt: now }, remainingQuantity: { $gte: a.quantity } },
                { $inc: { remainingQuantity: -a.quantity } }
            );
            if (r.modifiedCount === 1) {
                need -= a.quantity;
                taken.set(String(a.lot), (taken.get(String(a.lot)) || 0) + a.quantity);
            } else {
                conflicts++; // un autre mouvement a pris ces unités entre-temps : on relit les lots
            }
        }
        if (conflicts === 0) break;
    }
    return [...taken.entries()].map(([lot, q]) => ({ lot, quantity: q }));
}

/**
 * Point d'entrée des mouvements manuels : constate les péremptions, applique le mouvement,
 * puis répartit les sorties sur les lots en FEFO.
 */
async function recordMovement({ stockId, type, quantity, direction, reason, idempotencyKey, performedBy, now = new Date() }) {
    await sweepExpiredLots({ stockId, now });
    const result = await applyMovement({ stockId, type, quantity, direction, reason, idempotencyKey, performedBy });

    const decreases = result.movement.delta < 0;
    if (!result.replayed && decreases && ["OUT", "LOSS", "BREAKAGE", "ADJUSTMENT"].includes(type)) {
        const allocations = await allocateFromLots(stockId, quantity, now);
        if (allocations.length) {
            await StockMovement.updateOne({ _id: result.movement._id }, { allocations });
            result.movement.allocations = allocations;
        }
    }
    return result;
}

// Mise en quarantaine : le lot sort immédiatement du stock disponible.
async function quarantineLot({ lotId, reason, performedBy, idempotencyKey, now = new Date() }) {
    const lot = await Lot.findOneAndUpdate(
        { _id: lotId, state: "OK" },
        { state: "QUARANTINE", stateReason: reason, stateChangedAt: now },
        { returnDocument: "after" }
    );
    if (!lot) {
        throw (await Lot.exists({ _id: lotId }))
            ? new AppError(409, "Seul un lot actif peut être mis en quarantaine", "LOT_NOT_ACTIVE")
            : new AppError(404, "Lot introuvable", "LOT_NOT_FOUND");
    }
    if (lot.remainingQuantity > 0) {
        try {
            await applyMovement({
                stockId: lot.stock, type: "QUARANTINE", quantity: lot.remainingQuantity, reason, performedBy,
                idempotencyKey: `quarantine:${lot._id}:${idempotencyKey || crypto.randomUUID()}`
            });
        } catch (err) {
            await Lot.updateOne({ _id: lot._id }, { state: "OK", $unset: { stateReason: 1 } }); // on annule le basculement
            throw err;
        }
    }
    return lot;
}

// Libération : impossible si le lot est périmé entre-temps.
async function releaseLot({ lotId, reason, performedBy, idempotencyKey, now = new Date() }) {
    const lot = await Lot.findOneAndUpdate(
        { _id: lotId, state: "QUARANTINE", expiryDate: { $gt: now } },
        { state: "OK", stateReason: reason, stateChangedAt: now },
        { returnDocument: "after" }
    );
    if (!lot) {
        const existing = await Lot.findById(lotId);
        if (!existing) throw new AppError(404, "Lot introuvable", "LOT_NOT_FOUND");
        if (existing.state === "QUARANTINE") throw new AppError(409, "Ce lot est périmé : il ne peut pas être remis en vente", "LOT_EXPIRED");
        throw new AppError(409, "Ce lot n'est pas en quarantaine", "LOT_NOT_IN_QUARANTINE");
    }
    if (lot.remainingQuantity > 0) {
        try {
            await applyMovement({
                stockId: lot.stock, type: "RELEASE", quantity: lot.remainingQuantity, reason, performedBy,
                idempotencyKey: `release:${lot._id}:${idempotencyKey || crypto.randomUUID()}`
            });
        } catch (err) {
            await Lot.updateOne({ _id: lot._id }, { state: "QUARANTINE" });
            throw err;
        }
    }
    return lot;
}

// Les notions de stock du cahier des charges, calculées depuis les données réelles.
async function stockSummary(stockId, now = new Date()) {
    const stock = await Stock.findById(stockId).lean();
    const lots = await Lot.find({ stock: stockId, remainingQuantity: { $gt: 0 } }).lean();
    const sum = (arr) => arr.reduce((s, l) => s + l.remainingQuantity, 0);
    const ok = lots.filter((l) => l.state === "OK");
    const quarantined = sum(lots.filter((l) => l.state === "QUARANTINE"));
    const expired = sum(lots.filter((l) => l.state === "EXPIRED"));
    return {
        available: stock.quantity,                       // vendable
        quarantined, expired,
        physical: stock.quantity + quarantined + expired, // tout ce qui est physiquement présent
        inLots: sum(ok), withoutLot: stock.quantity - sum(ok),
        consistent: stock.quantity >= sum(ok),
        // Non implémentés à ce jour : stock réservé, stock en cours de réception.
        reserved: null, receiving: null
    };
}

module.exports = {
    receiveIntoLot, assertLotReceivable, sweepExpiredLots, allocateFromLots,
    recordMovement, quarantineLot, releaseLot, stockSummary
};
