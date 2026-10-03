import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, loginAs, inDays, Pharmacy, Medicine, Stock, Lot } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

const DAKAR = { latitude: 14.7167, longitude: -17.4677 };
const THIES = { latitude: 14.791, longitude: -16.9359 };

// Un médicament en stock dans une pharmacie + un patient connecté. price: null = pas de prix.
async function shop({ quantity = 20, price = 1500, publish = true, pharmacy = {} } = {}) {
    const s = await seedStock(quantity);
    if (price !== null) await Stock.updateOne({ _id: s.stock._id }, { price });
    await Pharmacy.updateOne({ _id: s.pharmacy._id }, { publishAvailability: publish, ...pharmacy });
    const patient = await loginAs(app, request, "patient");
    return { ...s, patient };
}

// Une 2e pharmacie qui a le même médicament.
async function addPharmacy(s, fields = {}, quantity = 20) {
    const pharmacy = await Pharmacy.create({
        name: "Pharmacie Deux", address: "2 rue Test", city: "Thiès", phone: "770000009",
        publishAvailability: true, ...fields
    });
    const stock = await Stock.create({ pharmacy: pharmacy._id, medicine: s.medicine._id, quantity, price: 1400 });
    return { pharmacy, stock };
}

const availability = (s, query = "") => s.patient.agent.get(`/api/catalog/medicines/${s.medicine._id}/availability${query}`);

describe("Accès", () => {
    it("connexion requise sur toutes les routes du catalogue", async () => {
        const id = "64b7f0c2a1b2c3d4e5f60718";
        expect((await request(app).get("/api/catalog/medicines?q=para")).status).toBe(401);
        expect((await request(app).get(`/api/catalog/medicines/${id}/availability`)).status).toBe(401);
        expect((await request(app).get("/api/catalog/pharmacies")).status).toBe(401);
    });
});

describe("Recherche de médicaments", () => {
    it("trouve sans tenir compte des accents ni de la casse, et n'expose que des champs publics", async () => {
        const s = await shop();
        await Medicine.updateOne({ _id: s.medicine._id }, { sourceReference: "ref-interne" });
        const res = await s.patient.agent.get("/api/catalog/medicines?q=PARACETAMOL");
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].name).toBe("Paracétamol TEST");
        expect(res.body[0]).not.toHaveProperty("sourceReference");
        expect(res.headers["x-total-count"]).toBe("1");
    });

    it("requête trop courte refusée ; caractères spéciaux neutralisés ; médicament inactif masqué", async () => {
        const s = await shop();
        expect((await s.patient.agent.get("/api/catalog/medicines?q=p")).status).toBe(400);
        const all = await s.patient.agent.get("/api/catalog/medicines?q=.*");
        expect(all.status).toBe(200);
        expect(all.body).toHaveLength(0);

        await Medicine.updateOne({ _id: s.medicine._id }, { isActive: false });
        expect((await s.patient.agent.get("/api/catalog/medicines?q=paracetamol")).body).toHaveLength(0);
    });
});

describe("Disponibilité par pharmacie", () => {
    it("une pharmacie qui ne publie pas sa disponibilité n'apparaît jamais", async () => {
        const s = await shop({ publish: false });
        const res = await availability(s);
        expect(res.status).toBe(200);
        expect(res.body.results).toHaveLength(0);
    });

    it("disponible : statut, prix et commandable ; quantité exacte seulement avec l'accord de la pharmacie", async () => {
        const s = await shop({ quantity: 20, price: 1500 });
        const first = (await availability(s)).body.results[0];
        expect(first.status).toBe("AVAILABLE");
        expect(first.price).toBe(1500);
        expect(first.orderable).toBe(true);
        expect(first.quantity).toBeUndefined();

        await Pharmacy.updateOne({ _id: s.pharmacy._id }, { publishQuantities: true });
        expect((await availability(s)).body.results[0].quantity).toBe(20);
    });

    it("stock faible signalé ; rupture masquée par défaut et visible sur demande, jamais commandable", async () => {
        const low = await shop({ quantity: 3 });
        expect((await availability(low)).body.results[0].status).toBe("LOW");

        const out = await shop({ quantity: 0 });
        expect((await availability(out)).body.results).toHaveLength(0);
        const shown = (await availability(out, "?includeOutOfStock=true")).body.results[0];
        expect(shown.status).toBe("OUT_OF_STOCK");
        expect(shown.orderable).toBe(false);
    });

    it("information trop ancienne : STALE, non commandable", async () => {
        const s = await shop();
        await Stock.collection.updateOne({ _id: s.stock._id }, { $set: { updatedAt: new Date(Date.now() - 4 * 86400000) } });
        const result = (await availability(s)).body.results[0];
        expect(result.status).toBe("STALE");
        expect(result.orderable).toBe(false);
    });

    it("sans prix ou sur ordonnance : visible mais non commandable", async () => {
        const noPrice = await shop({ price: null });
        expect((await availability(noPrice)).body.results[0].orderable).toBe(false);

        const rx = await shop();
        await Medicine.updateOne({ _id: rx.medicine._id }, { prescriptionRequired: true });
        const res = await availability(rx);
        expect(res.body.medicine.prescriptionRequired).toBe(true);
        expect(res.body.results[0].orderable).toBe(false);
    });

        it("lot périmé non encore constaté : jamais annoncé comme disponible", async () => {
        const s = await shop({ quantity: 0 });
        const staff = await loginAs(app, request, "pharmacy_manager", [s.pharmacy._id]);
        const received = await staff.agent.post("/api/deliveries").send({
            pharmacy: String(s.pharmacy._id), medicine: String(s.medicine._id), quantity: 20,
            lotNumber: "L1", expiryDate: inDays(30).toISOString()
        });
        expect(received.status).toBe(201);
        expect((await availability(s)).body.results[0].status).toBe("AVAILABLE");

        await Lot.updateOne({ lotNumber: "L1" }, { expiryDate: new Date(Date.now() - 1000) });
        const res = await availability(s, "?includeOutOfStock=true");
        expect(res.body.results[0].status).toBe("OUT_OF_STOCK");
        expect((await Stock.findById(s.stock._id)).quantity).toBe(0);
    });

    it("tri par distance, rayon et filtre de ville", async () => {
        const s = await shop({ pharmacy: { name: "Pharmacie Dakar", city: "Dakar", ...DAKAR } });
        await addPharmacy(s, { name: "Pharmacie Thiès", city: "Thiès", ...THIES });
        const here = "lat=14.69&lng=-17.44";

        const sorted = (await availability(s, `?${here}`)).body.results;
        expect(sorted.map((r) => r.pharmacy.name)).toEqual(["Pharmacie Dakar", "Pharmacie Thiès"]);
        expect(sorted[0].distanceKm).toBeLessThan(sorted[1].distanceKm);

        const near = (await availability(s, `?${here}&radiusKm=10`)).body.results;
        expect(near.map((r) => r.pharmacy.name)).toEqual(["Pharmacie Dakar"]);

        const thies = (await availability(s, "?city=thies")).body.results;
        expect(thies.map((r) => r.pharmacy.name)).toEqual(["Pharmacie Thiès"]);
    });

    it("une pharmacie sans coordonnées est exclue d'une recherche par rayon", async () => {
        const s = await shop({ pharmacy: { name: "Sans GPS" } });
        expect((await availability(s, "?lat=14.69&lng=-17.44&radiusKm=50")).body.results).toHaveLength(0);
        expect((await availability(s)).body.results).toHaveLength(1);
    });

    it("paramètres invalides : lat sans lng, rayon sans position, médicament inconnu", async () => {
        const s = await shop();
        expect((await availability(s, "?lat=14.69")).status).toBe(400);
        expect((await availability(s, "?radiusKm=5")).status).toBe(400);
        const res = await s.patient.agent.get("/api/catalog/medicines/64b7f0c2a1b2c3d4e5f60718/availability");
        expect(res.status).toBe(404);
    });

    it("parcours complet : un résultat commandable peut être commandé", async () => {
        const s = await shop({ quantity: 10, price: 1500 });
        const result = (await availability(s)).body.results[0];
        expect(result.orderable).toBe(true);

        const order = await s.patient.agent.post("/api/orders").send({
            pharmacy: result.pharmacy.id, fulfillment: "PICKUP",
            items: [{ medicine: String(s.medicine._id), quantity: 1 }]
        });
        expect(order.status).toBe(201);
        expect(order.body.order.total).toBe(1500);
    });
});

describe("Recherche de pharmacies", () => {
    it("par nom (sans accents), ville et proximité ; pharmacies inactives masquées ; e-mail non exposé", async () => {
        const s = await shop({ pharmacy: { name: "Pharmacie Thiès Centre", city: "Thiès", email: "prive@exemple.sn", ...THIES } });
        const other = await addPharmacy(s, { name: "Pharmacie Dakar Plateau", city: "Dakar", ...DAKAR });

        const byName = await s.patient.agent.get("/api/catalog/pharmacies?q=thies");
        expect(byName.body.map((p) => p.name)).toEqual(["Pharmacie Thiès Centre"]);
        expect(byName.body[0]).not.toHaveProperty("email");
        expect(byName.body[0].publishesAvailability).toBe(true);

        const nearest = await s.patient.agent.get("/api/catalog/pharmacies?lat=14.69&lng=-17.44");
        expect(nearest.body.map((p) => p.name)).toEqual(["Pharmacie Dakar Plateau", "Pharmacie Thiès Centre"]);

        await Pharmacy.updateOne({ _id: other.pharmacy._id }, { isActive: false });
        const all = await s.patient.agent.get("/api/catalog/pharmacies");
        expect(all.body.map((p) => p.name)).toEqual(["Pharmacie Thiès Centre"]);
        expect(all.headers["x-total-count"]).toBe("1");
    });
});