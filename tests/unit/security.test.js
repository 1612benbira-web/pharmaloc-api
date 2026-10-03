import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { hashPassword, verifyPassword } = require("../../src/services/passwordService");
const { parseCookies } = require("../../src/middlewares/auth");

describe("Mots de passe", () => {
    it("n'est jamais stocké en clair et le sel est aléatoire", async () => {
        const a = await hashPassword("MotDePasse2026!");
        const b = await hashPassword("MotDePasse2026!");
        expect(a).not.toContain("MotDePasse2026!");
        expect(a).not.toBe(b);
        expect(a.startsWith("scrypt$")).toBe(true);
    });

    it("accepte le bon mot de passe, refuse le mauvais et les hashes corrompus", async () => {
        const h = await hashPassword("MotDePasse2026!");
        expect(await verifyPassword("MotDePasse2026!", h)).toBe(true);
        expect(await verifyPassword("motdepasse2026!", h)).toBe(false);
        expect(await verifyPassword("x", "n-importe-quoi")).toBe(false);
        expect(await verifyPassword("x", undefined)).toBe(false);
    });
});

describe("Lecture des cookies", () => {
    it("extrait les cookies et ignore les valeurs mal formées", () => {
        expect(parseCookies("a=1; pl_session=abc123; b=%E0%A4%A")).toEqual({ a: "1", pl_session: "abc123" });
        expect(parseCookies(undefined)).toEqual({});
    });
});
