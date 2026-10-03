import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import createApp from "../../src/app.js";
import { startTestDb, stopTestDb, resetDb, seedStock, loginAs, Pharmacy, Medicine } from "./helpers.js";

const app = createApp();
beforeAll(startTestDb, 120000);
afterAll(stopTestDb);
beforeEach(resetDb);

// Un patient, un admin et (si une pharmacie est donnée) son responsable, tous connectés.
async function people(pharmacy) {
    const patient = await loginAs(app, request, "patient");
    const admin = await loginAs(app, request, "admin", []);
    const manager = pharmacy ? await loginAs(app, request, "pharmacy_manager", [pharmacy._id]) : null;
    return { patient, admin, manager };
}

const newPharmacy = (fields = {}) =>
    Pharmacy.create({ name: "Pharmacie Z", address: "3 rue Test", city: "Dakar", phone: "770000003", ...fields });

describe("Médicaments : lecture", () => {
    it("connexion requise", async () => {
        expect((await request(app).get("/api/medicines")).status).toBe(401);
        expect((await request(app).get("/api/medicines/64b7f0c2a1b2c3d4e5f60718")).status).toBe(401);
    });

    it("le patient voit les médicaments actifs et les champs publics ; le personnel voit aussi les inactifs ; l'admin voit tout", async () => {
        const s = await seedStock(5);
        await Medicine.updateOne({ _id: s.medicine._id }, { sourceReference: "ref-interne" });
        await Medicine.create({ name: "Brouillon", isActive: false });
        const { patient, admin, manager } = await people(s.pharmacy);

        const asPatient = await patient.agent.get("/api/medicines");
        expect(asPatient.status).toBe(200);
        expect(asPatient.body.map((m) => m.name)).toEqual(["Paracétamol TEST"]);
        expect(asPatient.body[0]).not.toHaveProperty("sourceReference");
        expect(asPatient.body[0]).not.toHaveProperty("isActive");

        const asManager = await manager.agent.get("/api/medicines");
        expect(asManager.body.map((m) => m.name).sort()).toEqual(["Brouillon", "Paracétamol TEST"]);
        expect(JSON.stringify(asManager.body)).not.toContain("sourceReference");

        const asAdmin = await admin.agent.get("/api/medicines");
        expect(asAdmin.body.find((m) => m.name === "Paracétamol TEST").sourceReference).toBe("ref-interne");
    });

    it("médicament inactif : 404 pour un patient, visible par l'admin", async () => {
        const hidden = await Medicine.create({ name: "Brouillon", isActive: false });
        const { patient, admin } = await people();
        expect((await patient.agent.get(`/api/medicines/${hidden._id}`)).status).toBe(404);
        expect((await admin.agent.get(`/api/medicines/${hidden._id}`)).status).toBe(200);
    });

    it("recherche sans accents, pagination et total", async () => {
        await Medicine.create([{ name: "Paracétamol 500" }, { name: "Paracétamol 1000" }, { name: "Amoxicilline" }]);
        const { patient } = await people();
        const found = await patient.agent.get("/api/medicines?q=paracetamol");
        expect(found.body).toHaveLength(2);
        const page = await patient.agent.get("/api/medicines?limit=1&page=2");
        expect(page.body).toHaveLength(1);
        expect(page.headers["x-total-count"]).toBe("3");
        expect((await patient.agent.get("/api/medicines?q=p")).status).toBe(400);
    });

    it("identifiant invalide : 400", async () => {
        const { patient } = await people();
        const res = await patient.agent.get("/api/medicines/abc");
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
    });
});

describe("Médicaments : écriture", () => {
    it("un responsable propose un médicament : inactif, soumis à ordonnance, invisible ; l'admin le valide", async () => {
        const s = await seedStock(0);
        const { patient, manager, admin } = await people(s.pharmacy);

        const forbidden = await manager.agent.post("/api/medicines").send({ name: "Nouveau Produit", prescriptionRequired: false });
        expect(forbidden.status).toBe(403);
        expect(forbidden.body.code).toBe("ADMIN_ONLY_FIELD");

        const res = await manager.agent.post("/api/medicines").send({ name: "Nouveau Produit", dosage: "500 mg" });
        expect(res.status).toBe(201);
        const doc = await Medicine.findById(res.body.medicine._id);
        expect(doc.isActive).toBe(false);
        expect(doc.prescriptionRequired).toBe(true);

        expect((await patient.agent.get("/api/medicines")).body.map((m) => m.name)).not.toContain("Nouveau Produit");
        expect((await patient.agent.get("/api/catalog/medicines?q=nouveau")).body).toHaveLength(0);

        const approved = await admin.agent.patch(`/api/medicines/${doc._id}`).send({ isActive: true, prescriptionRequired: false });
        expect(approved.status).toBe(200);
        expect((await patient.agent.get("/api/catalog/medicines?q=nouveau")).body).toHaveLength(1);
    });

    it("un admin crée un médicament directement actif ; champ inconnu, opérateur Mongo et nom manquant refusés", async () => {
        const { admin } = await people();
        const ok = await admin.agent.post("/api/medicines").send({ name: "Ibuprofène", prescriptionRequired: false });
        expect(ok.status).toBe(201);
        expect((await Medicine.findById(ok.body.medicine._id)).isActive).toBe(true);

        expect((await admin.agent.post("/api/medicines").send({ name: "X", dangereux: true })).status).toBe(400);
        expect((await admin.agent.post("/api/medicines").send({ name: "X", $set: { isActive: false } })).status).toBe(400);
        expect((await admin.agent.post("/api/medicines").send({ dosage: "5 mg" })).status).toBe(400);
    });

    it("un responsable ne peut pas retirer l'obligation d'ordonnance d'un médicament", async () => {
        const s = await seedStock(5);
        await Medicine.updateOne({ _id: s.medicine._id }, { prescriptionRequired: true });
        const { patient, manager } = await people(s.pharmacy);

        expect((await manager.agent.patch(`/api/medicines/${s.medicine._id}`).send({ prescriptionRequired: false })).status).toBe(403);
        expect((await patient.agent.patch(`/api/medicines/${s.medicine._id}`).send({ name: "X" })).status).toBe(403);
        expect((await Medicine.findById(s.medicine._id)).prescriptionRequired).toBe(true);
    });

    it("l'admin modifie ; une modification vide est refusée", async () => {
        const s = await seedStock(5);
        const { admin } = await people();
        const ok = await admin.agent.patch(`/api/medicines/${s.medicine._id}`).send({ dosage: "1000 mg" });
        expect(ok.status).toBe(200);
        expect(ok.body.medicine.dosage).toBe("1000 mg");
        expect((await admin.agent.patch(`/api/medicines/${s.medicine._id}`).send({})).status).toBe(400);
    });

    it("suppression : refusée si le médicament est utilisé, autorisée sinon, réservée à l'admin", async () => {
        const s = await seedStock(5);
        const free = await Medicine.create({ name: "Jamais utilisé" });
        const { admin, manager } = await people(s.pharmacy);

        expect((await manager.agent.delete(`/api/medicines/${free._id}`)).status).toBe(403);

        const blocked = await admin.agent.delete(`/api/medicines/${s.medicine._id}`);
        expect(blocked.status).toBe(409);
        expect(blocked.body.code).toBe("MEDICINE_IN_USE");
        expect(await Medicine.exists({ _id: s.medicine._id })).toBeTruthy();

        expect((await admin.agent.delete(`/api/medicines/${free._id}`)).status).toBe(200);
        expect(await Medicine.exists({ _id: free._id })).toBeNull();
    });
});

describe("Pharmacies : lecture", () => {
    it("connexion requise", async () => {
        expect((await request(app).get("/api/pharmacies")).status).toBe(401);
    });

    it("le patient ne voit que les pharmacies actives, sans e-mail ni réglages internes ; le responsable voit sa fiche complète ; l'admin voit tout", async () => {
        const s = await seedStock(1);
        await Pharmacy.updateOne({ _id: s.pharmacy._id }, { email: "prive@exemple.sn" });
        await newPharmacy({ name: "Fermée", isActive: false, email: "x@exemple.sn" });
        const { patient, manager, admin } = await people(s.pharmacy);

        const asPatient = await patient.agent.get("/api/pharmacies");
        expect(asPatient.status).toBe(200);
        expect(asPatient.body.map((p) => p.name)).toEqual(["Pharmacie TEST"]);
        const text = JSON.stringify(asPatient.body);
        for (const secret of ["email", "prive@exemple.sn", "isActive", "publishQuantities"]) expect(text).not.toContain(secret);
        expect(asPatient.body[0].publishesAvailability).toBe(false);

        const asManager = await manager.agent.get("/api/pharmacies");
        expect(asManager.body.map((p) => p.name)).toEqual(["Pharmacie TEST"]);
        expect(asManager.body[0].email).toBe("prive@exemple.sn");

        const asAdmin = await admin.agent.get("/api/pharmacies");
        expect(asAdmin.body.map((p) => p.name).sort()).toEqual(["Fermée", "Pharmacie TEST"]);
    });

    it("pharmacie inactive : 404 pour un patient, visible par l'admin et par son propre personnel", async () => {
        const s = await seedStock(1);
        await Pharmacy.updateOne({ _id: s.pharmacy._id }, { isActive: false });
        const { patient, manager, admin } = await people(s.pharmacy);
        expect((await patient.agent.get(`/api/pharmacies/${s.pharmacy._id}`)).status).toBe(404);
        expect((await admin.agent.get(`/api/pharmacies/${s.pharmacy._id}`)).status).toBe(200);
        expect((await manager.agent.get(`/api/pharmacies/${s.pharmacy._id}`)).status).toBe(200);
    });

    it("recherche par nom et ville sans accents, pagination et total", async () => {
        await newPharmacy({ name: "Pharmacie Thiès Centre", city: "Thiès" });
        await newPharmacy({ name: "Pharmacie Dakar Plateau", city: "Dakar" });
        const { patient } = await people();
        expect((await patient.agent.get("/api/pharmacies?q=thies")).body.map((p) => p.name)).toEqual(["Pharmacie Thiès Centre"]);
        expect((await patient.agent.get("/api/pharmacies?city=dakar")).body.map((p) => p.name)).toEqual(["Pharmacie Dakar Plateau"]);
        const page = await patient.agent.get("/api/pharmacies?limit=1");
        expect(page.body).toHaveLength(1);
        expect(page.headers["x-total-count"]).toBe("2");
    });
});

describe("Pharmacies : écriture", () => {
    it("création réservée à l'admin, avec validation stricte", async () => {
        const s = await seedStock(0);
        const { manager, admin } = await people(s.pharmacy);
        const body = { name: "Pharmacie Neuve", address: "5 rue Test", city: "Thiès", phone: "770000005" };

        expect((await manager.agent.post("/api/pharmacies").send(body)).status).toBe(403);
        expect((await admin.agent.post("/api/pharmacies").send({ name: "Incomplète" })).status).toBe(400);
        expect((await admin.agent.post("/api/pharmacies").send({ ...body, latitude: 200, longitude: 0 })).status).toBe(400);
        expect((await admin.agent.post("/api/pharmacies").send({ ...body, latitude: 14.7 })).status).toBe(400);
        expect((await admin.agent.post("/api/pharmacies").send({ ...body, role: "admin" })).status).toBe(400);

        const ok = await admin.agent.post("/api/pharmacies").send({ ...body, latitude: 14.79, longitude: -16.93 });
        expect(ok.status).toBe(201);
        expect(ok.body.pharmacy.city).toBe("Thiès");
    });

    it("le responsable règle sa pharmacie (horaires, publication) mais pas isActive ni celle d'un autre", async () => {
        const s = await seedStock(0);
        const other = await newPharmacy({ name: "Autre pharmacie" });
        const { manager } = await people(s.pharmacy);

        const ok = await manager.agent.patch(`/api/pharmacies/${s.pharmacy._id}`)
            .send({ openingHours: "8h-20h", publishAvailability: true, publishQuantities: true });
        expect(ok.status).toBe(200);
        const saved = await Pharmacy.findById(s.pharmacy._id);
        expect(saved.openingHours).toBe("8h-20h");
        expect(saved.publishAvailability).toBe(true);

        const suspended = await manager.agent.patch(`/api/pharmacies/${s.pharmacy._id}`).send({ isActive: false });
        expect(suspended.status).toBe(403);
        expect(suspended.body.code).toBe("ADMIN_ONLY_FIELD");

        const foreign = await manager.agent.patch(`/api/pharmacies/${other._id}`).send({ name: "Piratée" });
        expect(foreign.status).toBe(403);
        expect(foreign.body.code).toBe("FORBIDDEN_PHARMACY");
        expect((await Pharmacy.findById(other._id)).name).toBe("Autre pharmacie");
    });

    it("modification : champ inconnu, opérateur Mongo, e-mail invalide et corps vide refusés", async () => {
        const s = await seedStock(0);
        const { manager } = await people(s.pharmacy);
        const url = `/api/pharmacies/${s.pharmacy._id}`;
        expect((await manager.agent.patch(url).send({ $set: { isActive: true } })).status).toBe(400);
        expect((await manager.agent.patch(url).send({ inconnu: 1 })).status).toBe(400);
        expect((await manager.agent.patch(url).send({ email: "pas-un-email" })).status).toBe(400);
        expect((await manager.agent.patch(url).send({})).status).toBe(400);
        expect((await manager.agent.patch(url).send({ latitude: 14.7 })).status).toBe(400);
    });

    it("l'admin peut suspendre une pharmacie : elle disparaît pour les patients", async () => {
        const s = await seedStock(1);
        const { patient, admin } = await people();
        expect((await admin.agent.patch(`/api/pharmacies/${s.pharmacy._id}`).send({ isActive: false })).status).toBe(200);
        expect((await patient.agent.get("/api/pharmacies")).body).toHaveLength(0);
        expect((await patient.agent.get("/api/catalog/pharmacies")).body).toHaveLength(0);
    });

    it("suppression : refusée si la pharmacie est utilisée, autorisée sinon, réservée à l'admin", async () => {
        const s = await seedStock(1);
        const free = await newPharmacy({ name: "Jamais utilisée" });
        const { admin, manager } = await people(s.pharmacy);

        expect((await manager.agent.delete(`/api/pharmacies/${free._id}`)).status).toBe(403);

        const blocked = await admin.agent.delete(`/api/pharmacies/${s.pharmacy._id}`);
        expect(blocked.status).toBe(409);
        expect(blocked.body.code).toBe("PHARMACY_IN_USE");

        expect((await admin.agent.delete(`/api/pharmacies/${free._id}`)).status).toBe(200);
        expect(await Pharmacy.exists({ _id: free._id })).toBeNull();
    });
});