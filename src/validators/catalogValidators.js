const { z } = require("zod");
const { pagination } = require("./common");

const text = (min, max) => z.string().trim().min(min).max(max);
const boolString = z.enum(["true", "false"]).transform((v) => v === "true");

const geo = {
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(0.1).max(200).optional()
};

// lat et lng vont ensemble ; un rayon n'a de sens qu'avec une position.
function checkGeo(q, ctx) {
    if ((q.lat === undefined) !== (q.lng === undefined)) {
        ctx.addIssue({ code: "custom", path: ["lat"], message: "lat et lng vont ensemble" });
    }
    if (q.radiusKm !== undefined && q.lat === undefined) {
        ctx.addIssue({ code: "custom", path: ["radiusKm"], message: "Un rayon exige lat et lng" });
    }
}

const medicineSearchQuery = pagination.extend({ q: text(2, 60) });

const availabilityQuery = pagination
    .extend({ city: text(2, 80).optional(), ...geo, includeOutOfStock: boolString.optional() })
    .superRefine(checkGeo);

const pharmacySearchQuery = pagination
    .extend({ q: text(2, 60).optional(), city: text(2, 80).optional(), ...geo })
    .superRefine(checkGeo);

module.exports = { medicineSearchQuery, availabilityQuery, pharmacySearchQuery };