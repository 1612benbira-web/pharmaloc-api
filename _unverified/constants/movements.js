// Types de mouvement. Le sens (+/-) est déduit du type ; la quantité est toujours positive.
const INCREASING = ["IN", "ADJUSTMENT_UP"];
const DECREASING = ["OUT", "LOSS", "BREAKAGE", "EXPIRY", "ADJUSTMENT_DOWN"];
const ALL_TYPES = [...INCREASING, ...DECREASING];
// Tout sauf réception et vente exige une justification (traçabilité des corrections).
const REASON_REQUIRED = ALL_TYPES.filter((t) => !["IN", "OUT"].includes(t));

module.exports = { INCREASING, DECREASING, ALL_TYPES, REASON_REQUIRED };
