const Shipment = require("../models/Shipment");
const Order = require("../models/Order");
const AppError = require("../utils/AppError");
const shipmentService = require("../services/shipmentService");

// Express 5 transmet automatiquement les erreurs async à errorHandler : pas de try/catch.

const pharmacyBrief = (p) =>
    p && p.name !== undefined
        ? { id: p._id, name: p.name, address: p.address, city: p.city, phone: p.phone }
        : { id: p };

const itemsOf = (s) => s.items.map((i) => ({ name: i.name, quantity: i.quantity }));

// Liste des courses disponibles : adresse visible (pour choisir), téléphone du client PAS encore.
const availableView = (s) => ({
    id: s._id, pharmacy: pharmacyBrief(s.pharmacy), address: s.address,
    itemsCount: s.items.reduce((n, i) => n + i.quantity, 0), attempt: s.attempt, createdAt: s.createdAt
});

// Course prise par le livreur : téléphone et contenu visibles. Jamais de prix, jamais de code de remise.
const courierView = (s) => ({
    id: s._id, orderId: s.order, status: s.status, pharmacy: pharmacyBrief(s.pharmacy),
    address: s.address, contactPhone: s.contactPhone, items: itemsOf(s), attempt: s.attempt,
    assignedAt: s.assignedAt, pickedUpAt: s.pickedUpAt, deliveredAt: s.deliveredAt,
    failedAt: s.failedAt, failureReason: s.failureReason
});

// Vue du personnel de la pharmacie : suivi, sans code de remise.
const staffView = (s) => ({
    id: s._id, orderId: s.order, status: s.status, attempt: s.attempt, address: s.address,
    courier: s.courier && s.courier.name !== undefined ? { id: s.courier._id, name: s.courier.name } : s.courier || null,
    assignedAt: s.assignedAt, pickedUpAt: s.pickedUpAt, deliveredAt: s.deliveredAt,
    failedAt: s.failedAt, failureReason: s.failureReason, createdAt: s.createdAt
});

// Vue du patient : SEUL endroit où le code de remise est visible, et seulement tant que la course est ouverte.
const patientView = (s) => ({
    id: s._id, status: s.status, attempt: s.attempt,
    courier: s.courier && s.courier.name !== undefined ? { name: s.courier.name } : null,
    ...(s.isOpen ? { deliveryCode: s.deliveryCode } : {}),
    assignedAt: s.assignedAt, pickedUpAt: s.pickedUpAt, deliveredAt: s.deliveredAt
});

async function listShipments(res, scope, { page, limit }, { sort, populate }) {
    let query = Shipment.find(scope).sort(sort).skip((page - 1) * limit).limit(limit).lean();
    for (const p of populate) query = query.populate(...p);
    const [shipments, total] = await Promise.all([query, Shipment.countDocuments(scope)]);
    res.set("X-Total-Count", String(total));
    return shipments;
}

const PHARMACY_FIELDS = ["pharmacy", "name address city phone"];

const listAvailable = async (req, res) => {
    const { page, limit } = req.valid.query;
    const scope = { status: "PENDING", pharmacy: { $in: req.user.pharmacies } };
    const rows = await listShipments(res, scope, { page, limit }, { sort: { createdAt: 1 }, populate: [PHARMACY_FIELDS] });
    res.status(200).json(rows.map(availableView));
};

const listMine = async (req, res) => {
    const { status, ...paging } = req.valid.query;
    const scope = { courier: req.user._id, ...(status ? { status } : {}) };
    const rows = await listShipments(res, scope, paging, { sort: { createdAt: -1 }, populate: [PHARMACY_FIELDS] });
    res.status(200).json(rows.map(courierView));
};

const listPharmacy = async (req, res) => {
    const { status, ...paging } = req.valid.query;
    const scope = { pharmacy: { $in: req.user.pharmacies }, ...(status ? { status } : {}) };
    const rows = await listShipments(res, scope, paging, { sort: { createdAt: -1 }, populate: [["courier", "name"]] });
    res.status(200).json(rows.map(staffView));
};

const getForOrder = async (req, res) => {
    const order = await Order.findOne({ _id: req.valid.params.orderId, user: req.user._id });
    if (!order) throw new AppError(404, "Commande introuvable", "ORDER_NOT_FOUND");
    const shipment = await Shipment.findOne({ order: order._id }).sort({ createdAt: -1 })
        .select("+deliveryCode").populate("courier", "name");
    if (!shipment) throw new AppError(404, "Aucune livraison pour cette commande pour le moment", "SHIPMENT_NOT_FOUND");
    res.status(200).json(patientView(shipment));
};

// Actions du livreur : même forme de réponse pour toutes.
const act = (service, message, extra = {}) => async (req, res) => {
    const result = await service({ shipmentId: req.valid.params.id, courier: req.user, ...req.valid.body });
    const shipment = result.shipment || result;
    await shipment.populate(...PHARMACY_FIELDS);
    res.status(200).json({
        message: typeof message === "function" ? message(result) : message,
        shipment: courierView(shipment),
        ...(result.redispatched !== undefined ? { redispatched: result.redispatched } : {}),
        ...extra
    });
};

const claim = act(shipmentService.claim, "Course prise en charge");
const release = act(shipmentService.release, "Course rendue : elle redevient disponible");
const pickup = act(shipmentService.pickup, "Commande récupérée : livraison en cours");
const deliver = act(shipmentService.deliver, "Livraison confirmée");
const fail = act(shipmentService.fail, (r) =>
    r.redispatched ? "Échec enregistré : une nouvelle course est proposée" : "Échec enregistré : la pharmacie doit intervenir");

module.exports = { listAvailable, listMine, listPharmacy, getForOrder, claim, release, pickup, deliver, fail };