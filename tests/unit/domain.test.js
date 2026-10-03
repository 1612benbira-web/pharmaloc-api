import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const S = require("../../src/domain/stockMath");
const R = require("../../src/domain/replenishment");
const A = require("../../src/domain/alertRules");
const PO = require("../../src/domain/purchaseOrderFlow");

const NOW = new Date("2026-09-30T12:00:00Z");
const days = (n) => new Date(NOW.getTime() + n * 86400000);
const lot = (id, expiry, remaining, state = "OK", lotNumber = `L${id}`) =>
    ({ _id: id, lotNumber, expiryDate: expiry, remainingQuantity: remaining, state });

describe("Lots : classification et péremption", () => {
    it("détecte lot expiré, proche de péremption, sain et en quarantaine", () => {
        expect(S.classifyLot(lot("a", days(-1), 5), NOW)).toBe("EXPIRED");
        expect(S.classifyLot(lot("b", days(10), 5), NOW)).toBe("NEAR_EXPIRY");
        expect(S.classifyLot(lot("c", days(100), 5), NOW)).toBe("OK");
        expect(S.classifyLot(lot("d", days(100), 5, "QUARANTINE"), NOW)).toBe("QUARANTINE");
        expect(S.classifyLot(lot("e", days(100), 5, "EXPIRED"), NOW)).toBe("EXPIRED");
    });

    it("un lot périmé ou en quarantaine n'est JAMAIS vendable", () => {
        expect(S.isSellable(lot("a", days(-1), 5), NOW)).toBe(false);
        expect(S.isSellable(lot("b", days(100), 5, "QUARANTINE"), NOW)).toBe(false);
        expect(S.isSellable(lot("c", days(100), 0), NOW)).toBe(false);
        expect(S.isSellable(lot("d", days(100), 5), NOW)).toBe(true);
    });

    it("la péremption le jour même (date = maintenant) rend le lot non vendable", () => {
        expect(S.isSellable(lot("a", NOW, 5), NOW)).toBe(false);
    });
});

describe("FEFO", () => {
    const lots = [
        lot("A", days(150), 5), lot("B", days(90), 4),
        lot("C", days(-30), 10), lot("D", days(60), 10, "QUARANTINE"), lot("E", days(40), 0)
    ];

    it("prélève d'abord le lot qui périme le plus tôt", () => {
        const plan = S.planFEFO(lots, 7, NOW);
        expect(plan.allocations).toEqual([{ lot: "B", quantity: 4 }, { lot: "A", quantity: 3 }]);
        expect(plan.remainder).toBe(0);
    });

    it("ne touche jamais aux lots périmés, en quarantaine ou vides ; le reste est 'sans lot'", () => {
        const plan = S.planFEFO(lots, 12, NOW);
        expect(plan.allocations.map((a) => a.lot)).toEqual(["B", "A"]);
        expect(plan.fromLots).toBe(9);
        expect(plan.remainder).toBe(3);
    });
});

describe("Seuils et disponibilité", () => {
    it("stock faible : strictement sous le seuil, pas en rupture", () => {
        expect(S.isLowStock({ quantity: 9, minimumQuantity: 10 })).toBe(true);
        expect(S.isLowStock({ quantity: 10, minimumQuantity: 10 })).toBe(false);
        expect(S.isLowStock({ quantity: 0, minimumQuantity: 10 })).toBe(false);
    });

    it("statuts de disponibilité patient, sans jamais inventer", () => {
        const fresh = days(-1);
        expect(S.availabilityStatus({ quantity: 50, minimumQuantity: 10, updatedAt: fresh, now: NOW })).toBe("AVAILABLE");
        expect(S.availabilityStatus({ quantity: 5, minimumQuantity: 10, updatedAt: fresh, now: NOW })).toBe("LOW");
        expect(S.availabilityStatus({ quantity: 0, minimumQuantity: 10, updatedAt: fresh, now: NOW })).toBe("OUT_OF_STOCK");
        expect(S.availabilityStatus({ quantity: 50, updatedAt: days(-10), now: NOW })).toBe("STALE");
        expect(S.availabilityStatus({ quantity: 50, now: NOW })).toBe("UNCONFIRMED");
    });

    it("sens des mouvements ; un ajustement exige une direction", () => {
        expect(S.movementDelta("OUT", 3)).toBe(-3);
        expect(S.movementDelta("LOSS", 3)).toBe(-3);
        expect(S.movementDelta("RETURN", 3)).toBe(3);
        expect(S.movementDelta("ADJUSTMENT", 3, "UP")).toBe(3);
        expect(S.movementDelta("ADJUSTMENT", 3, "DOWN")).toBe(-3);
        expect(() => S.movementDelta("ADJUSTMENT", 3)).toThrow();
        expect(() => S.movementDelta("MAGIE", 3)).toThrow();
    });
});

describe("Réapprovisionnement", () => {
    it("formule de base : cible - disponible - déjà commandé", () => {
        const r = R.suggestOrderQuantity({ targetQuantity: 100, availableQuantity: 30, onOrderQuantity: 20 });
        expect(r.quantity).toBe(50);
        expect(r.reason).toBe("REPLENISH");
    });

    it("arrondit au conditionnement fournisseur vers le haut", () => {
        expect(R.suggestOrderQuantity({ targetQuantity: 100, availableQuantity: 50, packSize: 12 }).quantity).toBe(60);
    });

    it("respecte la commande minimale, puis le conditionnement", () => {
        expect(R.suggestOrderQuantity({ targetQuantity: 53, availableQuantity: 50, minOrderQuantity: 10 }).quantity).toBe(10);
        expect(R.suggestOrderQuantity({ targetQuantity: 53, availableQuantity: 50, minOrderQuantity: 10, packSize: 6 }).quantity).toBe(12);
    });

    it("ne propose rien si le stock et les commandes couvrent la cible", () => {
        const r = R.suggestOrderQuantity({ targetQuantity: 50, availableQuantity: 40, onOrderQuantity: 15 });
        expect(r.quantity).toBe(0);
        expect(r.reason).toBe("NOT_NEEDED");
    });

    it("une commande en cours évite de recommander deux fois", () => {
        const base = { targetQuantity: 100, availableQuantity: 10 };
        expect(R.suggestOrderQuantity(base).quantity).toBe(90);
        expect(R.suggestOrderQuantity({ ...base, onOrderQuantity: 90 }).quantity).toBe(0);
    });

    it("sans cible ni historique : refuse de deviner", () => {
        const r = R.suggestOrderQuantity({ availableQuantity: 5 });
        expect(r.quantity).toBe(0);
        expect(r.reason).toBe("INSUFFICIENT_DATA");
    });

    it("avec demande : couvre le délai de livraison + marge + stock de sécurité", () => {
        // 10/j * 5 j * 1.25 + 8 = 70.5 -> 71
        const r = R.suggestOrderQuantity({
            targetQuantity: 40, availableQuantity: 20, dailyDemand: 10, leadTimeDays: 5, safetyFactor: 0.25, safetyStock: 8
        });
        expect(r.effectiveTarget).toBe(71);
        expect(r.method).toBe("DEMAND");
        expect(r.quantity).toBe(51);
    });

    it("la cible manuelle l'emporte quand elle est plus haute que la demande", () => {
        const r = R.suggestOrderQuantity({ targetQuantity: 200, availableQuantity: 0, dailyDemand: 10, leadTimeDays: 5, safetyFactor: 0.25, safetyStock: 8 });
        expect(r.method).toBe("TARGET");
        expect(r.quantity).toBe(200);
    });

    it("estimation de la demande : moyenne quotidienne sur historique suffisant", () => {
        const sales = Array.from({ length: 10 }, (_, i) => ({ quantity: 3, createdAt: days(-(20 - i * 2)) }));
        const d = R.estimateDailyDemand(sales, { now: NOW });
        expect(d.dailyDemand).toBeCloseTo(30 / 20);
        expect(d.confidence).toBe("LOW");
    });

    it("estimation de la demande : historique trop court => null, pas d'invention", () => {
        const sales = [1, 2, 3].map((i) => ({ quantity: 5, createdAt: days(-i) }));
        const d = R.estimateDailyDemand(sales, { now: NOW });
        expect(d.dailyDemand).toBeNull();
        expect(d.confidence).toBe("INSUFFICIENT");
        expect(R.estimateDailyDemand([{ quantity: 5, createdAt: days(-90) }], { now: NOW }).dailyDemand).toBeNull();
    });
});

describe("Alertes", () => {
    const stock = { _id: "s1", quantity: 5, minimumQuantity: 10, leadTimeDays: 7 };
    const types = (alerts) => alerts.map((a) => a.type).sort();

    it("stock sous le seuil => LOW_STOCK ; à 0 => OUT_OF_STOCK seulement", () => {
        expect(types(A.evaluateStockAlerts({ stock, now: NOW }))).toEqual(["LOW_STOCK"]);
        expect(types(A.evaluateStockAlerts({ stock: { ...stock, quantity: 0 }, now: NOW }))).toEqual(["OUT_OF_STOCK"]);
        expect(A.evaluateStockAlerts({ stock: { ...stock, quantity: 50 }, now: NOW })).toEqual([]);
    });

    it("rupture probable uniquement avec demande connue et sans commande en route", () => {
        expect(types(A.evaluateStockAlerts({ stock, dailyDemand: 2, now: NOW }))).toEqual(["LOW_STOCK", "STOCKOUT_RISK"]);
        expect(types(A.evaluateStockAlerts({ stock, dailyDemand: 2, onOrderQuantity: 10, now: NOW }))).toEqual(["LOW_STOCK"]);
        expect(types(A.evaluateStockAlerts({ stock, dailyDemand: null, now: NOW }))).toEqual(["LOW_STOCK"]);
    });

    it("alertes de lots : périmé, proche de péremption ; lots vides ignorés", () => {
        const lots = [lot("x", days(-2), 4, "OK"), lot("y", days(10), 3), lot("z", days(10), 0), lot("w", days(200), 2)];
        const alerts = A.evaluateStockAlerts({ stock: { ...stock, quantity: 50 }, lots, now: NOW });
        expect(types(alerts)).toEqual(["LOT_EXPIRED", "LOT_NEAR_EXPIRY"]);
    });

    it("écart d'inventaire si les lots actifs dépassent le stock disponible", () => {
        const lots = [lot("a", days(100), 8), lot("b", days(120), 4)];
        const alerts = A.evaluateStockAlerts({ stock: { ...stock, quantity: 5 }, lots, now: NOW });
        expect(types(alerts)).toContain("INVENTORY_DISCREPANCY");
    });

    it("déduplication : deux évaluations identiques produisent les mêmes clés, toutes uniques", () => {
        const lots = [lot("x", days(-2), 4), lot("y", days(10), 3)];
        const a = A.evaluateStockAlerts({ stock, lots, dailyDemand: 2, now: NOW }).map((x) => x.dedupeKey);
        const b = A.evaluateStockAlerts({ stock, lots, dailyDemand: 2, now: NOW }).map((x) => x.dedupeKey);
        expect(a).toEqual(b);
        expect(new Set(a).size).toBe(a.length);
    });

    it("gros ajustement négatif signalé ; petits ajustements et hausses ignorés", () => {
        const m = (delta, stockBefore) => ({ _id: `m${delta}`, type: "ADJUSTMENT", delta, stockBefore, status: "APPLIED", reason: "x" });
        expect(A.evaluateAdjustmentAlerts([m(-6, 40)])).toHaveLength(1);
        expect(A.evaluateAdjustmentAlerts([m(-3, 40), m(-10, 200), m(50, 10)])).toHaveLength(0);
    });

    it("commandes : en attente de validation et livraison en retard", () => {
        const orders = [
            { _id: "o1", status: "PENDING_APPROVAL" },
            { _id: "o2", status: "SENT", expectedDate: days(-3) },
            { _id: "o3", status: "SENT", expectedDate: days(3) },
            { _id: "o4", status: "RECEIVED", expectedDate: days(-3) }
        ];
        expect(A.evaluateOrderAlerts(orders, NOW).map((a) => a.dedupeKey)).toEqual(["PO_PENDING:o1", "PO_LATE:o2"]);
    });
});

describe("Commandes fournisseurs : workflow", () => {
    it("transitions autorisées et interdites", () => {
        expect(PO.canTransition("DRAFT", "PENDING_APPROVAL")).toBe(true);
        expect(PO.canTransition("DRAFT", "SENT")).toBe(false);          // pas d'envoi sans approbation
        expect(PO.canTransition("PENDING_APPROVAL", "SENT")).toBe(false);
        expect(PO.canTransition("APPROVED", "SENT")).toBe(true);
        expect(PO.canTransition("RECEIVED", "CANCELLED")).toBe(false);
        expect(PO.canTransition("SENT", "RECEIVED")).toBe(false);       // réservé aux réceptions
    });

    it("approuver/envoyer exige un responsable ; soumettre un brouillon non", () => {
        expect(PO.requiredRole("PENDING_APPROVAL", "APPROVED")).toBe("pharmacy_manager");
        expect(PO.requiredRole("APPROVED", "SENT")).toBe("pharmacy_manager");
        expect(PO.requiredRole("DRAFT", "PENDING_APPROVAL")).toBe("staff");
        expect(PO.requiredRole("DRAFT", "CANCELLED")).toBe("staff");
        expect(PO.requiredRole("SENT", "CANCELLED")).toBe("pharmacy_manager");
    });

    it("statut après réception : partielle tant que toutes les lignes ne sont pas complètes", () => {
        expect(PO.statusAfterReceipt([{ quantityOrdered: 10, quantityReceived: 4 }])).toBe("PARTIALLY_RECEIVED");
        expect(PO.statusAfterReceipt([{ quantityOrdered: 10, quantityReceived: 10 }, { quantityOrdered: 5, quantityReceived: 2 }])).toBe("PARTIALLY_RECEIVED");
        expect(PO.statusAfterReceipt([{ quantityOrdered: 10, quantityReceived: 10 }, { quantityOrdered: 5, quantityReceived: 6 }])).toBe("RECEIVED");
    });
});
