const paidOrderService = require("../services/paidOrderService");

const MESSAGES = {
    REFUNDED: "Commande annulée, produits remis en stock et client remboursé",
    PENDING: "Commande annulée et produits remis en stock. Le remboursement n'a pas pu être effectué : il est à traiter dans l'administration",
    NONE: "Commande annulée et produits remis en stock"
};

const cancelPaidOrder = async (req, res) => {
    const { order, refund } = await paidOrderService.cancelPaidOrder({
        orderId: req.valid.params.id, actor: req.user, reason: req.valid.body.reason
    });
    res.status(200).json({ message: MESSAGES[refund.status], order, refund: { status: refund.status } });
};

module.exports = { cancelPaidOrder };
