const { z } = require("zod");
const { pagination } = require("./common");

const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (min, max) => z.string().trim().min(min).max(max).optional();
const hasAnyField = (b) => Object.values(b).some((v) => v !== undefined);

// Corps STRICTS : un champ inconnu (ou un opérateur Mongo comme $set) est refusé, jamais ignoré en silence.

// ---- Médicaments ----
const medicineFields = {
    name: text(120), genericName: text(120), laboratory: text(120), category: text(80),
    dosage: text(60), form: text(60), activeIngredient: text(120), packaging: text(120),
    sourceReference: text(200), prescriptionRequired: z.boolean(), isActive: z.boolean()
};
const optionalMedicine = Object.fromEntries(Object.entries(medicineFields).map(([k, v]) => [k, v.optional()]));

const createMedicineBody = z.strictObject({ ...optionalMedicine, name: medicineFields.name });
const updateMedicineBody = z.strictObject(optionalMedicine).refine(hasAnyField, { message: "Aucun champ à modifier" });
const medicineListQuery = pagination.extend({ q: optionalText(2, 60) });

// ---- Pharmacies ----
const pharmacyFields = {
    name: text(120), address: text(200), city: text(80), phone: text(30),
    email: z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide")),
    latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
    openingHours: z.string().trim().max(300),
    publishAvailability: z.boolean(), publishQuantities: z.boolean(), isActive: z.boolean()
};
const optionalPharmacy = Object.fromEntries(Object.entries(pharmacyFields).map(([k, v]) => [k, v.optional()]));

// latitude et longitude vont ensemble.
function coordinatesTogether(b, ctx) {
    if ((b.latitude === undefined) !== (b.longitude === undefined)) {
        ctx.addIssue({ code: "custom", path: ["latitude"], message: "latitude et longitude vont ensemble" });
    }
}

const createPharmacyBody = z
    .strictObject({
        ...optionalPharmacy,
        name: pharmacyFields.name, address: pharmacyFields.address, city: pharmacyFields.city, phone: pharmacyFields.phone
    })
    .superRefine(coordinatesTogether);

const updatePharmacyBody = z
    .strictObject(optionalPharmacy)
    .refine(hasAnyField, { message: "Aucun champ à modifier" })
    .superRefine(coordinatesTogether);

const pharmacyListQuery = pagination.extend({ q: optionalText(2, 60), city: optionalText(2, 80) });

module.exports = {
    createMedicineBody, updateMedicineBody, medicineListQuery,
    createPharmacyBody, updatePharmacyBody, pharmacyListQuery
};