const { z } = require("zod");
const { pagination } = require("./common");

// Seuls les comptes du personnel sont listés : les patients ne sont pas exposés à l'administration.
const STAFF_ROLES = ["pharmacist", "pharmacy_manager", "courier", "admin"];

const userListQuery = pagination.extend({
    role: z.enum(STAFF_ROLES).optional(),
    q: z.string().trim().min(2).max(60).optional()
});
const userStatusBody = z.strictObject({ isActive: z.boolean() });

const auditListQuery = pagination.extend({ action: z.string().trim().min(2).max(60).optional() });

module.exports = { STAFF_ROLES, userListQuery, userStatusBody, auditListQuery };
