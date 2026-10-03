const PurchaseOrder = require("../models/PurchaseOrder");
const Supplier = require("../models/Supplier");
const Stock = require("../models/Stock");
const AppError = require("../utils/AppError");
const { canTransition, requiredRole, statusAfterReceipt, RECEIVABLE_STATUSES } = require("../domain/purchaseOrderFlow");
const { getSuggestions } = require("./replenishmentService");

async function assertSupplierOf(pharmacyId, supplierId) {
    const supplier = await Supplier.findOne({ _id: supplierId, pharmacy: pharmacyId, isActive: true });
    if (!supplier) throw new AppError(404, "Fournisseur introuvable pour cette pharmacie", "SUPPLIER_NOT_FOUND");
    return supplier;
}

// Crée un BROUILLON. Aucun effet sur le stock : une commande n'est pas une réception.
async function createDraft({ pharmacyId, supplierId, lines, expectedDate, notes, source = "MANUAL", createdBy }) {
    await assertSupplierOf(pharmacyId, supplierId);

    const ids = [...new Set(lines.map((l) => String(l.stock)))];
    if (ids.length !== lines.length) throw new AppError(400, "Un produit ne peut apparaître qu'une fois par commande", "DUPLICATE_LINE");
    const stocks = await Stock.find({ _id: { $in: ids }, pharmacy: pharmacyId }).select("medicine").lean();
    if (stocks.length !== ids.length) throw new AppError(404, "Un des produits n'appartient pas à cette pharmacie", "STOCK_NOT_FOUND");
    const medicineOf = new Map(stocks.map((s) => [String(s._id), s.medicine]));

    return PurchaseOrder.create({
        pharmacy: pharmacyId, supplier: supplierId, expectedDate, notes, source, createdBy,
        lines: lines.map((l) => ({
            stock: l.stock, medicine: medicineOf.get(String(l.stock)),
            quantityOrdered: l.quantity, unitPrice: l.unitPrice
        }))
    });
}

// Les quantités viennent du calcul serveur déterministe, pas du client.
async function createDraftFromSuggestions({ pharmacyId, supplierId, stockIds, expectedDate, createdBy }) {
    const suggestions = await getSuggestions({ pharmacyIds: [pharmacyId], stockIds });
    if (suggestions.length === 0) {
        throw new AppError(409, "Aucune suggestion de commande pour ces produits", "NOTHING_TO_ORDER");
    }
    return createDraft({
        pharmacyId, supplierId, expectedDate, createdBy, source: "REPLENISHMENT",
        lines: suggestions.map((s) => ({ stock: s.stock, quantity: s.suggestion.quantity })),
        notes: "Brouillon généré par le calcul de réapprovisionnement. À vérifier avant validation."
    });
}

// Transition atomique : le filtre sur l'ancien statut empêche deux actions concurrentes de se cumuler.
async function transition({ order, to, user, reason, now = new Date() }) {
    if (!canTransition(order.status, to)) {
        throw new AppError(409, `Passage de ${order.status} à ${to} impossible`, "INVALID_TRANSITION");
    }
    if (requiredRole(order.status, to) === "pharmacy_manager" && user.role !== "pharmacy_manager") {
        throw new AppError(403, "Cette action est réservée au responsable de la pharmacie", "FORBIDDEN_ROLE");
    }
    if (to === "CANCELLED" && (!reason || reason.trim().length < 5)) {
        throw new AppError(400, "Un motif d'annulation d'au moins 5 caractères est obligatoire", "REASON_REQUIRED");
    }

    const set = { status: to };
    if (to === "APPROVED") Object.assign(set, { approvedBy: user._id, approvedAt: now });
    if (to === "SENT") set.sentAt = now;
    if (to === "CANCELLED") set.cancelReason = reason.trim();

    const updated = await PurchaseOrder.findOneAndUpdate({ _id: order._id, status: order.status }, set, { returnDocument: "after" });
    if (!updated) throw new AppError(409, "La commande a été modifiée entre-temps", "ORDER_CHANGED");
    return updated;
}

// Vérifie qu'une livraison peut être rattachée à la commande, AVANT de toucher au stock.
async function assertReceivable({ orderId, pharmacyId, stockId }) {
    const order = await PurchaseOrder.findOne({ _id: orderId, pharmacy: pharmacyId });
    if (!order) throw new AppError(404, "Commande introuvable", "ORDER_NOT_FOUND");
    if (!RECEIVABLE_STATUSES.includes(order.status)) {
        throw new AppError(409, "Cette commande n'est pas en attente de réception", "ORDER_NOT_RECEIVABLE");
    }
    if (!order.lines.some((l) => String(l.stock) === String(stockId))) {
        throw new AppError(409, "Produit inattendu : il ne figure pas sur cette commande", "PRODUCT_NOT_ON_ORDER");
    }
    return order;
}

// Enregistre la quantité réellement reçue et recalcule le statut (partielle ou terminée).
async function registerReceipt({ orderId, stockId, quantity }) {
    await PurchaseOrder.updateOne(
        { _id: orderId, "lines.stock": stockId },
        { $inc: { "lines.$.quantityReceived": quantity } }
    );
    const order = await PurchaseOrder.findById(orderId);
    const status = statusAfterReceipt(order.lines);
    const updated = await PurchaseOrder.findOneAndUpdate(
        { _id: orderId, status: { $in: RECEIVABLE_STATUSES } }, { status }, { returnDocument: "after" }
    );
    const line = order.lines.find((l) => String(l.stock) === String(stockId));
    return { order: updated || order, overDelivery: line.quantityReceived > line.quantityOrdered };
}

module.exports = { createDraft, createDraftFromSuggestions, transition, assertReceivable, registerReceipt };
