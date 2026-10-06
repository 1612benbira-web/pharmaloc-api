const Order = require("../models/Order");
const Payment = require("../models/Payment");
const Shipment = require("../models/Shipment");
const AppError = require("../utils/AppError");
const { releaseOrderStock } = require("./orderService");
const { refundPayment } = require("./paymentService");
const { canAccessPharmacy } = require("./accessService");

// Une commande déjà remise au livreur ou terminée ne s'annule plus par ce chemin (le livreur signale d'abord l'échec).
const CANCELLABLE = ["CONFIRMED", "PREPARING", "READY"];

/**
 * Annulation d'une commande PAYÉE par le responsable de la pharmacie (ou un administrateur) :
 *  1. la commande est annulée de façon atomique (une seule annulation possible) ;
 *  2. sa course de livraison non récupérée est fermée ;
 *  3. les produits sont remis en vente (stock et lots) ;
 *  4. le client est remboursé. Si le remboursement échoue, la commande reste annulée et le paiement est
 *     marqué "à traiter" : l'administrateur le rembourse ensuite depuis son écran.
 */
async function cancelPaidOrder({ orderId, actor, reason }) {
    const found = await Order.findById(orderId);
    if (!found || (actor.role !== "admin" && !canAccessPharmacy(actor, found.pharmacy))) {
        throw new AppError(404, "Commande introuvable", "ORDER_NOT_FOUND");
    }

    const order = await Order.findOneAndUpdate(
        { _id: orderId, status: { $in: CANCELLABLE } },
        { status: "CANCELLED", cancellationReason: reason },
        { returnDocument: "after" }
    );
    if (!order) {
        throw new AppError(409, "Cette commande ne peut plus être annulée (en livraison, terminée ou déjà annulée)", "ORDER_NOT_CANCELLABLE");
    }

    await Shipment.updateMany(
        { order: order._id, isOpen: true, status: { $in: ["PENDING", "ASSIGNED"] } },
        { status: "FAILED", isOpen: false, failedAt: new Date(), failureReason: "Commande annulée" }
    );
    await releaseOrderStock(order, actor._id);

    const payment = await Payment.findOne({ order: order._id, status: "PAID" });
    let refund = { status: "NONE" };
    if (payment) {
        try {
            const result = await refundPayment({ paymentId: payment._id, reason });
            refund = { status: "REFUNDED", payment: result.payment };
        } catch (err) {
            await Payment.updateOne({ _id: payment._id }, { needsReview: true });
            refund = { status: "PENDING" };
        }
    }
    return { order, refund };
}

module.exports = { cancelPaidOrder };
