const express = require("express");
const validate = require("../middlewares/validate");
const { authenticate, requireRole } = require("../middlewares/auth");
const { idParam } = require("../validators/common");
const v = require("../validators/inventoryValidators");
const lots = require("../controllers/lotController");
const suppliers = require("../controllers/supplierController");
const orders = require("../controllers/purchaseOrderController");
const replenishment = require("../controllers/replenishmentController");
const alerts = require("../controllers/alertController");

// Tout est réservé au personnel de pharmacie et cloisonné par pharmacie (vérifié dans les contrôleurs).
const staff = requireRole("pharmacist", "pharmacy_manager");
const manager = requireRole("pharmacy_manager");

const lotRouter = express.Router();
lotRouter.use(authenticate, staff);
lotRouter.get("/", validate({ query: v.lotListQuery }), lots.listLots);
lotRouter.post("/:id/quarantine", validate({ params: idParam, body: v.lotReasonBody }), lots.quarantine);
lotRouter.post("/:id/release", manager, validate({ params: idParam, body: v.lotReasonBody }), lots.release);

const supplierRouter = express.Router();
supplierRouter.use(authenticate, staff);
supplierRouter.get("/", validate({ query: v.supplierListQuery }), suppliers.listSuppliers);
supplierRouter.post("/", manager, validate({ body: v.createSupplierBody }), suppliers.createSupplier);
supplierRouter.patch("/:id", manager, validate({ params: idParam, body: v.updateSupplierBody }), suppliers.updateSupplier);

const orderRouter = express.Router();
orderRouter.use(authenticate, staff);
orderRouter.get("/", validate({ query: v.orderListQuery }), orders.listOrders);
orderRouter.post("/", validate({ body: v.createOrderBody }), orders.createOrder);
orderRouter.post("/from-suggestions", validate({ body: v.fromSuggestionsBody }), orders.createFromSuggestions);
orderRouter.get("/:id", validate({ params: idParam }), orders.getOrder);
orderRouter.post("/:id/transition", validate({ params: idParam, body: v.transitionBody }), orders.transitionOrder);

const replenishmentRouter = express.Router();
replenishmentRouter.use(authenticate, staff);
replenishmentRouter.get("/suggestions", validate({ query: v.suggestionsQuery }), replenishment.suggestions);

const alertRouter = express.Router();
alertRouter.use(authenticate, staff);
alertRouter.get("/", validate({ query: v.alertListQuery }), alerts.listAlerts);
alertRouter.post("/evaluate", validate({ body: v.evaluateAlertsBody }), alerts.evaluate);
alertRouter.post("/:id/acknowledge", validate({ params: idParam }), alerts.acknowledge);

module.exports = { lotRouter, supplierRouter, orderRouter, replenishmentRouter, alertRouter };
