const { ZodError } = require("zod");
const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const { isProduction } = require("../config/env");

const notFound = (req, res) => {
    res.status(404).json({ message: "Route introuvable", code: "ROUTE_NOT_FOUND" });
};

// Format unique : { message, code, details? }. Jamais de stack ni de message interne.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
    if (err instanceof AppError) {
        return res.status(err.status).json({
            message: err.message,
            code: err.code,
            ...(err.details ? { details: err.details } : {})
        });
    }

    if (err instanceof ZodError) {
        return res.status(400).json({
            message: "Données invalides",
            code: "VALIDATION_ERROR",
            details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message }))
        });
    }

    if (err instanceof mongoose.Error.ValidationError) {
        return res.status(400).json({
            message: "Données invalides",
            code: "VALIDATION_ERROR",
            details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }))
        });
    }

    if (err instanceof mongoose.Error.CastError) {
        return res.status(400).json({ message: "Identifiant invalide", code: "INVALID_ID" });
    }

    if (err && err.code === 11000) {
        return res.status(409).json({ message: "Cette ressource existe déjà", code: "DUPLICATE" });
    }

    if (err && err.type === "entity.parse.failed") {
        return res.status(400).json({ message: "JSON invalide", code: "INVALID_JSON" });
    }

    console.error("Erreur non gérée :", isProduction ? err.message : err);
    res.status(500).json({ message: "Erreur interne du serveur", code: "INTERNAL_ERROR" });
};

module.exports = { notFound, errorHandler };
