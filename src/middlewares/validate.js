// Valide req.params / req.query / req.body avec des schémas Zod ; résultat dans req.valid.
const validate = (schemas) => (req, res, next) => {
    req.valid = {};
    for (const source of ["params", "query", "body"]) {
        if (schemas[source]) {
            req.valid[source] = schemas[source].parse(req[source] ?? {});
        }
    }
    next();
};

module.exports = validate;
