// Règles PURES des courses de livraison : sans base de données, faciles à tester.
const crypto = require("crypto");

const OPEN_STATUSES = ["PENDING", "ASSIGNED", "PICKED_UP"];
const MAX_CODE_ATTEMPTS = 5;     // codes de remise erronés avant blocage de la saisie
const MAX_DELIVERY_ATTEMPTS = 3; // tentatives de livraison avant intervention de la pharmacie

const TRANSITIONS = {
    PENDING: ["ASSIGNED"],
    ASSIGNED: ["PENDING", "PICKED_UP"], // le livreur peut rendre la course avant de partir
    PICKED_UP: ["DELIVERED", "FAILED"],
    DELIVERED: [],
    FAILED: []
};

const canShipmentTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

// Code à 6 chiffres tiré avec un générateur cryptographique (jamais Math.random).
const generateDeliveryCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

// Comparaison à temps constant.
function codeMatches(expected, given) {
    const a = Buffer.from(String(expected));
    const b = Buffer.from(String(given));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
    OPEN_STATUSES, MAX_CODE_ATTEMPTS, MAX_DELIVERY_ATTEMPTS, TRANSITIONS,
    canShipmentTransition, generateDeliveryCode, codeMatches
};