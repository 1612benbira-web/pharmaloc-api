const mongoose = require("mongoose");
const Order = require("../models/Order");
const Stock = require("../models/Stock");
const Lot = require("../models/Lot");
const { pharmacyScope } = require("../services/scopeService");

const DAY_MS = 24 * 60 * 60 * 1000;
// Commandes réellement payées et non annulées : les annulées (donc remboursées) et expirées n'entrent pas dans les ventes.
const SOLD = ["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"];

// Tableau de bord d'une pharmacie : ventes de la période, produits les plus vendus, état du stock et des lots.
const pharmacyStats = async (req, res) => {
    const { days, pharmacy } = req.valid.query;
    // Le périmètre est celui de l'utilisateur : une pharmacie d'un autre répond 403 (pharmacyScope).
    const ids = pharmacyScope(req.user, pharmacy).map((id) => new mongoose.Types.ObjectId(String(id)));
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    const sold = { pharmacy: { $in: ids }, createdAt: { $gte: since }, status: { $in: SOLD } };

    const [totals, top, byStatus, outOfStock, lowStock, expiring] = await Promise.all([
        Order.aggregate([
            { $match: sold },
            { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$total" }, deliveryFees: { $sum: "$deliveryFee" } } }
        ]),
        Order.aggregate([
            { $match: sold },
            { $unwind: "$items" },
            { $group: {
                _id: "$items.medicine", name: { $first: "$items.name" },
                quantity: { $sum: "$items.quantity" },
                revenue: { $sum: { $multiply: ["$items.quantity", "$items.unitPrice"] } }
            } },
            { $sort: { quantity: -1, name: 1 } },
            { $limit: 5 }
        ]),
        Order.aggregate([
            { $match: { pharmacy: { $in: ids }, createdAt: { $gte: since } } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]),
        Stock.countDocuments({ pharmacy: { $in: ids }, quantity: 0 }),
        Stock.countDocuments({ pharmacy: { $in: ids }, quantity: { $gt: 0 }, $expr: { $lt: ["$quantity", "$minimumQuantity"] } }),
        Lot.countDocuments({
            pharmacy: { $in: ids }, state: "OK", remainingQuantity: { $gt: 0 },
            expiryDate: { $gt: now, $lte: new Date(now.getTime() + 30 * DAY_MS) }
        })
    ]);

    const t = totals[0] || { orders: 0, revenue: 0, deliveryFees: 0 };
    res.status(200).json({
        days,
        since,
        orders: t.orders,
        revenue: t.revenue,
        deliveryFees: t.deliveryFees,
        averageBasket: t.orders ? Math.round(t.revenue / t.orders) : 0,
        topProducts: top.map((p) => ({ medicineId: p._id, name: p.name, quantity: p.quantity, revenue: p.revenue })),
        ordersByStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
        stock: { outOfStock, lowStock, lotsExpiringIn30Days: expiring }
    });
};

module.exports = { pharmacyStats };
