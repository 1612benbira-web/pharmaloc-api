// Règles PURES de la recherche patient : sans base de données, faciles à tester.
const { availabilityStatus } = require("./stockMath");

// Ordre d'affichage quand on ne trie pas par distance.
const STATUS_RANK = { AVAILABLE: 0, LOW: 1, STALE: 2, UNCONFIRMED: 3, OUT_OF_STOCK: 4 };

// Distance à vol d'oiseau entre deux points GPS, en kilomètres.
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// Lettres accentuées équivalentes (minuscules ET majuscules, pour ne pas dépendre de l'option "i" de MongoDB).
const CLASSES = {
    a: "[aàâäAÀÂÄ]", c: "[cçCÇ]", e: "[eéèêëEÉÈÊË]", i: "[iîïIÎÏ]",
    o: "[oôöOÔÖ]", u: "[uùûüUÙÛÜ]", y: "[yÿYŸ]"
};

/**
 * Expression régulière insensible à la casse ET aux accents ("paracetamol" trouve "Paracétamol").
 * Tout caractère spécial saisi par l'utilisateur est neutralisé : ".*" ne peut pas servir à tout lister.
 */
function accentInsensitiveRegex(input, { exact = false } = {}) {
    const base = String(input).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const body = [...base].map((ch) => CLASSES[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
    return new RegExp(exact ? `^${body}$` : body, "i");
}

/**
 * Ce qu'un patient a le droit de voir d'un stock. Ne "devine" jamais :
 * donnée trop ancienne => STALE. La quantité exacte exige l'accord de la pharmacie.
 */
function patientAvailability({ stock, pharmacy, medicine, now = new Date() }) {
    const status = availabilityStatus({
        quantity: stock.quantity, minimumQuantity: stock.minimumQuantity, updatedAt: stock.updatedAt, now
    });
    const inStock = status === "AVAILABLE" || status === "LOW";
    const hasPrice = typeof stock.price === "number";
    return {
        status,
        lastUpdatedAt: stock.updatedAt,
        ...(hasPrice ? { price: stock.price, currency: "XOF" } : {}),
        ...(pharmacy.publishQuantities && inStock ? { quantity: stock.quantity } : {}),
        // Vrai uniquement si l'API de commande acceptera ce produit.
        orderable: inStock && hasPrice && !medicine.prescriptionRequired
    };
}

module.exports = { STATUS_RANK, haversineKm, accentInsensitiveRegex, patientAvailability };