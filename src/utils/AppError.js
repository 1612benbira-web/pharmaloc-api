// Erreur "métier" : son message est sûr à montrer à l'utilisateur.
class AppError extends Error {
    constructor(status, message, code, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

module.exports = AppError;
