import { describe, it, expect } from "vitest";
import shipmentFlow from "../../src/domain/shipmentFlow.js";
import orderFlow from "../../src/domain/orderFlow.js";

const { canShipmentTransition, generateDeliveryCode, codeMatches } = shipmentFlow;
const { managedByShipment } = orderFlow;

describe("canShipmentTransition", () => {
    it("parcours normal", () => {
        expect(canShipmentTransition("PENDING", "ASSIGNED")).toBe(true);
        expect(canShipmentTransition("ASSIGNED", "PICKED_UP")).toBe(true);
        expect(canShipmentTransition("PICKED_UP", "DELIVERED")).toBe(true);
    });

    it("le livreur peut rendre une course avant de partir, pas après", () => {
        expect(canShipmentTransition("ASSIGNED", "PENDING")).toBe(true);
        expect(canShipmentTransition("PICKED_UP", "PENDING")).toBe(false);
    });

    it("pas de saut d'étape ; les états finaux sont définitifs", () => {
        expect(canShipmentTransition("PENDING", "PICKED_UP")).toBe(false);
        expect(canShipmentTransition("ASSIGNED", "DELIVERED")).toBe(false);
        expect(canShipmentTransition("DELIVERED", "FAILED")).toBe(false);
        expect(canShipmentTransition("FAILED", "ASSIGNED")).toBe(false);
    });
});

describe("code de remise", () => {
    it("6 chiffres, toujours", () => {
        for (let i = 0; i < 200; i++) expect(generateDeliveryCode()).toMatch(/^\d{6}$/);
    });

    it("comparaison exacte", () => {
        expect(codeMatches("004217", "004217")).toBe(true);
        expect(codeMatches("004217", "004218")).toBe(false);
        expect(codeMatches("004217", "4217")).toBe(false);
    });
});

describe("managedByShipment", () => {
    it("livraison : remise et clôture appartiennent au livreur ; retrait : non concerné", () => {
        expect(managedByShipment("DELIVERY", "OUT_FOR_DELIVERY")).toBe(true);
        expect(managedByShipment("DELIVERY", "COMPLETED")).toBe(true);
        expect(managedByShipment("DELIVERY", "READY")).toBe(false);
        expect(managedByShipment("PICKUP", "COMPLETED")).toBe(false);
    });
});