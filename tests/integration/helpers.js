import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createRequire } from "module";

// Les modèles sont en CommonJS : on les charge avec require (comme l'application)
// pour n'obtenir qu'une seule instance et éviter OverwriteModelError.
const require = createRequire(import.meta.url);
export const Pharmacy = require("../../src/models/Pharmacy");
export const Medicine = require("../../src/models/Medicine");
export const Stock = require("../../src/models/Stock");
export const StockMovement = require("../../src/models/StockMovement");
export const Delivery = require("../../src/models/Delivery");
export const User = require("../../src/models/User");
export const Session = require("../../src/models/Session");
export const AuditLog = require("../../src/models/AuditLog");
export const Lot = require("../../src/models/Lot");
export const Supplier = require("../../src/models/Supplier");
export const PurchaseOrder = require("../../src/models/PurchaseOrder");
export const Alert = require("../../src/models/Alert");
const authService = require("../../src/services/authService");
export const PASSWORD = "MotDePasse-Test-2026";

let mongod;

// Base 100 % isolée en mémoire : la vraie base "pharmaloc" n'est jamais touchée.
export async function startTestDb() {
    const external = process.env.TEST_MONGODB_URI;
    if (external) {
        // Garde-fou : on refuse toute base dont le nom ne contient pas "test" (jamais la vraie base).
        const dbName = new URL(external).pathname.replace("/", "");
        if (!/test/i.test(dbName)) {
            throw new Error(`TEST_MONGODB_URI doit viser une base dont le nom contient "test" (reçu : "${dbName}")`);
        }
        // FerretDB (utile pour tester sans MongoDB) n'implémente pas les index TTL : on les retire
        // du schéma POUR CES TESTS UNIQUEMENT. Le vrai MongoDB les gère, et la production les garde.
        for (const model of [Session]) {
            model.schema._indexes = model.schema._indexes.filter(([, opts]) => !("expireAfterSeconds" in opts));
        }
        await mongoose.connect(external);
    } else {
        mongod = await MongoMemoryServer.create();
        await mongoose.connect(mongod.getUri("pharmaloc_test"));
    }
    // Indispensable : crée les index uniques (idempotence) avant les tests.
    await Promise.all([Stock, StockMovement, Delivery, User, Session, Lot, Supplier, PurchaseOrder, Alert].map((m) => m.init()));
}

export async function stopTestDb() {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
}

export async function resetDb() {
    await Promise.all([Stock, StockMovement, Delivery, Pharmacy, Medicine, User, Session, AuditLog, Lot, Supplier, PurchaseOrder, Alert].map((m) => m.deleteMany({})));
}

export async function seedStock(quantity = 0) {
    const pharmacy = await Pharmacy.create({
        name: "Pharmacie TEST", address: "1 rue Test", city: "Dakar", phone: "770000000"
    });
    const medicine = await Medicine.create({ name: "Paracétamol TEST" });
    const stock = await Stock.create({ pharmacy: pharmacy._id, medicine: medicine._id, quantity });
    return { pharmacy, medicine, stock };
}

let counter = 0;

// Crée un utilisateur puis ouvre une VRAIE session via /api/auth/login (cookie conservé par l'agent).
export async function loginAs(app, request, role, pharmacies = []) {
    const email = `user${++counter}-${role}@test.sn`;
    const user = await authService.createUser({ name: "Utilisateur Test", email, password: PASSWORD, role, pharmacies });
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`Connexion de test échouée : ${res.status}`);
    return { agent, user, email };
}

// Ajoute un autre produit (médicament + stock) à une pharmacie existante.
export async function addStock(pharmacy, quantity = 0, name = "Produit TEST 2") {
    const medicine = await Medicine.create({ name });
    const stock = await Stock.create({ pharmacy: pharmacy._id, medicine: medicine._id, quantity });
    return { medicine, stock };
}

export const inDays = (n) => new Date(Date.now() + n * 86400000);
