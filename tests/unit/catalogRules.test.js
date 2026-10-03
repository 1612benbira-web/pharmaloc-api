import { describe, it, expect } from "vitest";
import rules from "../../src/domain/catalogRules.js";

const { haversineKm, accentInsensitiveRegex, patientAvailability } = rules;

describe("haversineKm", () => {
    it("même point : 0 ; Dakar-Thiès : environ 55 km", () => {
        expect(haversineKm(14.7167, -17.4677, 14.7167, -17.4677)).toBe(0);
        const d = haversineKm(14.7167, -17.4677, 14.791, -16.9359);
        expect(d).toBeGreaterThan(50);
        expect(d).toBeLessThan(62);
    });
});

describe("accentInsensitiveRegex", () => {
    it("ignore accents et casse", () => {
        expect(accentInsensitiveRegex("paracetamol").test("Paracétamol 500 mg")).toBe(true);
        expect(accentInsensitiveRegex("PARACÉTAMOL").test("paracetamol")).toBe(true);
        expect(accentInsensitiveRegex("amoxicilline").test("Ibuprofène")).toBe(false);
    });

    it("neutralise les caractères spéciaux : '.*' ne liste pas tout", () => {
        expect(accentInsensitiveRegex(".*").test("Paracétamol")).toBe(false);
        expect(() => accentInsensitiveRegex("(((")).not.toThrow();
    });

    it("mode exact pour les villes", () => {
        expect(accentInsensitiveRegex("thies", { exact: true }).test("Thiès")).toBe(true);
        expect(accentInsensitiveRegex("thies", { exact: true }).test("Thiès Nord")).toBe(false);
    });
});

describe("patientAvailability", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    const fresh = new Date("2026-10-03T10:00:00Z");
    const medicine = { prescriptionRequired: false };
    const view = (stock, pharmacy = {}, med = medicine) => patientAvailability({ stock, pharmacy, medicine: med, now });

    it("disponible, faible, rupture", () => {
        expect(view({ quantity: 20, minimumQuantity: 10, updatedAt: fresh }).status).toBe("AVAILABLE");
        expect(view({ quantity: 3, minimumQuantity: 10, updatedAt: fresh }).status).toBe("LOW");
        expect(view({ quantity: 0, minimumQuantity: 10, updatedAt: fresh }).status).toBe("OUT_OF_STOCK");
    });

    it("donnée trop ancienne : STALE, jamais présentée comme disponible ni commandable", () => {
        const old = new Date("2026-09-28T10:00:00Z");
        const v = view({ quantity: 20, minimumQuantity: 10, updatedAt: old, price: 1000 }, { publishQuantities: true });
        expect(v.status).toBe("STALE");
        expect(v.orderable).toBe(false);
        expect(v.quantity).toBeUndefined();
    });

    it("la quantité exacte exige l'accord de la pharmacie", () => {
        const stock = { quantity: 20, minimumQuantity: 10, updatedAt: fresh };
        expect(view(stock, { publishQuantities: false }).quantity).toBeUndefined();
        expect(view(stock, { publishQuantities: true }).quantity).toBe(20);
    });

    it("commandable seulement avec prix, en stock et sans ordonnance", () => {
        const stock = { quantity: 20, minimumQuantity: 10, updatedAt: fresh, price: 1500 };
        expect(view(stock).orderable).toBe(true);
        expect(view({ ...stock, price: undefined }).orderable).toBe(false);
        expect(view(stock, {}, { prescriptionRequired: true }).orderable).toBe(false);
        expect(view({ ...stock, quantity: 0 }).orderable).toBe(false);
    });
});