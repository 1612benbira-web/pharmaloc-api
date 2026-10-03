import { describe, it, expect } from "vitest";
import flow from "../../src/domain/orderFlow.js";

const { canTransition, computeTotals } = flow;

describe("computeTotals", () => {
    const lines = [{ unitPrice: 1500, quantity: 2 }, { unitPrice: 500, quantity: 1 }];

    it("retrait : pas de frais de livraison", () => {
        expect(computeTotals(lines, "PICKUP", 750)).toEqual({ itemsTotal: 3500, deliveryFee: 0, total: 3500 });
    });

    it("livraison : les frais s'ajoutent au total", () => {
        expect(computeTotals(lines, "DELIVERY", 750)).toEqual({ itemsTotal: 3500, deliveryFee: 750, total: 4250 });
    });
});

describe("canTransition", () => {
    it("parcours retrait", () => {
        expect(canTransition("CONFIRMED", "PREPARING", "PICKUP")).toBe(true);
        expect(canTransition("PREPARING", "READY", "PICKUP")).toBe(true);
        expect(canTransition("READY", "COMPLETED", "PICKUP")).toBe(true);
    });

    it("parcours livraison : passe obligatoirement par OUT_FOR_DELIVERY", () => {
        expect(canTransition("READY", "OUT_FOR_DELIVERY", "DELIVERY")).toBe(true);
        expect(canTransition("READY", "COMPLETED", "DELIVERY")).toBe(false);
        expect(canTransition("OUT_FOR_DELIVERY", "COMPLETED", "DELIVERY")).toBe(true);
    });

    it("un retrait ne peut pas partir en livraison", () => {
        expect(canTransition("READY", "OUT_FOR_DELIVERY", "PICKUP")).toBe(false);
    });

    it("pas de saut d'étape ni de retour en arrière", () => {
        expect(canTransition("CONFIRMED", "READY", "PICKUP")).toBe(false);
        expect(canTransition("PREPARING", "CONFIRMED", "PICKUP")).toBe(false);
        expect(canTransition("PAYMENT_PENDING", "PREPARING", "PICKUP")).toBe(false);
    });

    it("les états finaux sont définitifs", () => {
        for (const final of ["COMPLETED", "CANCELLED", "EXPIRED"]) {
            expect(canTransition(final, "PREPARING", "PICKUP")).toBe(false);
        }
    });
});