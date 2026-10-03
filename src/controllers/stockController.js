const Stock = require("../models/Stock");
const Pharmacy = require("../models/Pharmacy");
const Medicine = require("../models/Medicine");
const StockMovement = require("../models/StockMovement");
const AppError = require("../utils/AppError");
const { canAccessPharmacy, assertPharmacyAccess } = require("../services/accessService");
const { applyMovement } = require("../services/stockService");
const { recordMovement, stockSummary } = require("../services/lotService");
const { idempotencyHeader } = require("../validators/stockValidators");
const { pagination } = require("../validators/common");

// Retourne le stock si l'utilisateur y a accès. Sinon 404 (on ne révèle pas l'existence d'un stock d'une autre pharmacie).
async function loadAccessibleStock(user, id) {
    const stock = await Stock.findById(id).select("pharmacy");
    if (!stock || !canAccessPharmacy(user, stock.pharmacy)) {
        throw new AppError(404, "Stock introuvable", "STOCK_NOT_FOUND");
    }
    return stock;
}

// Express 5 transmet automatiquement les erreurs async à errorHandler : pas de try/catch.

const createStock = async (req, res) => {
    const { pharmacy, medicine, quantity, minimumQuantity } = req.valid.body;
    assertPharmacyAccess(req.user, pharmacy);

    if (!(await Pharmacy.exists({ _id: pharmacy }))) throw new AppError(404, "Pharmacie introuvable", "PHARMACY_NOT_FOUND");
    if (!(await Medicine.exists({ _id: medicine }))) throw new AppError(404, "Médicament introuvable", "MEDICINE_NOT_FOUND");

    // Le stock est toujours créé à 0 ; un stock initial passe par un mouvement traçable.
    const stock = await Stock.create({
        pharmacy, medicine, quantity: 0,
        ...(minimumQuantity !== undefined ? { minimumQuantity } : {})
    });

    let initialMovement;
    if (quantity > 0) {
        ({ movement: initialMovement } = await applyMovement({
            stockId: stock._id, type: "IN", quantity, reason: "Stock initial", performedBy: req.user._id
        }));
    }

    res.status(201).json({
        message: "Stock créé avec succès",
        stock: await Stock.findById(stock._id),
        ...(initialMovement ? { movement: initialMovement } : {})
    });
};

const getStocks = async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const scope = { pharmacy: { $in: req.user.pharmacies } };
    const [stocks, total] = await Promise.all([
        Stock.find(scope).populate("pharmacy").populate("medicine")
            .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        Stock.countDocuments(scope)
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(stocks);
};

const getStockById = async (req, res) => {
    await loadAccessibleStock(req.user, req.valid.params.id);
    const stock = await Stock.findById(req.valid.params.id).populate("pharmacy").populate("medicine");
    if (!stock) throw new AppError(404, "Stock introuvable", "STOCK_NOT_FOUND");
    res.status(200).json(stock);
};

const updateStock = async (req, res) => {
    await loadAccessibleStock(req.user, req.valid.params.id);
    const { quantity, ...fields } = req.valid.body; // `quantity` est déjà refusé par la validation
    const stock = await Stock.findByIdAndUpdate(req.valid.params.id, fields, { returnDocument: "after", runValidators: true })
        .populate("pharmacy").populate("medicine");
    res.status(200).json({ message: "Stock modifié avec succès", stock });
};

const deleteStock = async (req, res) => {
    const id = req.valid.params.id;
    await loadAccessibleStock(req.user, id);
    // L'historique ne doit pas disparaître ni devenir orphelin.
    if (await StockMovement.exists({ stock: id })) {
        throw new AppError(409, "Ce stock a un historique de mouvements et ne peut pas être supprimé", "STOCK_HAS_HISTORY");
    }
    const stock = await Stock.findByIdAndDelete(id);
    if (!stock) throw new AppError(404, "Stock introuvable", "STOCK_NOT_FOUND");
    res.status(200).json({ message: "Stock supprimé avec succès" });
};

const createMovement = async (req, res) => {
    const key = idempotencyHeader.parse(req.get("Idempotency-Key"));
    const { type, quantity, direction, reason } = req.valid.body;

    // Une correction d'inventaire engage la comptabilité du stock : responsable uniquement.
    // Contrôle du rôle AVANT tout accès base : échec rapide, et rien n'est révélé sur le stock.
    if (type === "ADJUSTMENT" && req.user.role !== "pharmacy_manager") {
        throw new AppError(403, "Une correction d'inventaire est réservée au responsable de la pharmacie", "FORBIDDEN_ROLE");
    }
    await loadAccessibleStock(req.user, req.valid.params.id);

    const result = await recordMovement({
        stockId: req.valid.params.id, type, quantity, direction, reason,
        idempotencyKey: key, performedBy: req.user._id
    });

    res.status(result.replayed ? 200 : 201).json({
        message: result.replayed ? "Opération déjà enregistrée" : "Mouvement enregistré",
        replayed: result.replayed,
        movement: result.movement,
        stock: { id: result.stock._id, quantity: result.stock.quantity }
    });
};

const getSummary = async (req, res) => {
    await loadAccessibleStock(req.user, req.valid.params.id);
    res.status(200).json(await stockSummary(req.valid.params.id));
};

const getMovements = async (req, res) => {
    const id = req.valid.params.id;
    const { page, limit } = pagination.parse(req.query);
    await loadAccessibleStock(req.user, id);

    const [movements, total] = await Promise.all([
        StockMovement.find({ stock: id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        StockMovement.countDocuments({ stock: id })
    ]);
    res.set("X-Total-Count", String(total));
    res.status(200).json(movements);
};

module.exports = { createStock, getStocks, getStockById, updateStock, deleteStock, createMovement, getMovements, getSummary };
