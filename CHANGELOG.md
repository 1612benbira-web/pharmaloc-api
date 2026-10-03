# Changelog

## [2.0.0-dev] - 2026-09-30 (développé pendant la période CADEV)

### Code préexistant (v1, NON créé pendant le concours)
Modèles Medicine, Pharmacy, Stock, Delivery, StockMovement (version initiale) ; contrôleurs et routes
medicines, pharmacies, stocks, deliveries (version initiale) ; server.js et database.js d'origine.
Les modèles Delivery et StockMovement et les contrôleurs stock/delivery ont depuis été **modifiés** (voir ci-dessous).

### Nouveau
- `src/app.js` (application testable), `src/config/env.js`, `.env.example`, `.gitignore`
- `src/middlewares/errorHandler.js`, `validate.js`, `src/utils/AppError.js`
- `src/validators/*` (Zod)
- `src/services/stockService.js` : mouvements atomiques et idempotents
- Endpoints `POST/GET /api/stocks/:id/movements`
- Tests : `tests/unit` (10), `tests/integration` (14)
- `docs/AUDIT.md`

### Nouveau - authentification et autorisations (2e étape)
- Modèles `User`, `Session`, `AuditLog` ; `src/services/passwordService.js` (scrypt), `authService.js`, `accessService.js`, `auditService.js`
- `src/middlewares/auth.js` (session par cookie), `originCheck.js` (défense CSRF)
- Routes `/api/auth/{register,login,logout,logout-all,me}` et `POST /api/admin/users`
- `scripts/createAdmin.js` (`npm run create-admin`) pour créer le premier administrateur
- Tests : 40 unitaires ; 34 d'intégration au total (`stock.test.js`, `auth.test.js`)

### Nouveau - stocks avancés (3e étape)
- Domaine pur sans base de données, testé : `src/domain/` (FEFO, classification des lots, disponibilité, réapprovisionnement, règles d'alerte, workflow des commandes)
- Modèles `Lot`, `Supplier`, `PurchaseOrder`, `Alert`
- Services `lotService`, `alertService`, `replenishmentService`, `purchaseOrderService`, `scopeService`
- Routes `/api/lots`, `/api/suppliers`, `/api/purchase-orders`, `/api/replenishment/suggestions`, `/api/alerts`, `GET /api/stocks/:id/summary`
- Mouvements : `RETURN`, `LOSS`, `BREAKAGE`, `ADJUSTMENT` (signé, justifié), `EXPIRY`, `QUARANTINE`, `RELEASE`
- Livraison : lot + péremption + commande rattachée
- Tests : 110 unitaires (exécutés) ; 68 d'intégration (non exécutés dans l'environnement de l'assistant)
- `docs/STOCK_MODEL.md`, `docs/PROVENANCE.md`

### Corrigé après exécution réelle des tests d'intégration (Windows, Node 26, MongoDB)
- Premier résultat : 64/68 tests d'intégration passaient (concurrence, idempotence, quarantaine, cloisonnement, alertes inclus).
- Défaut de code corrigé : la réponse de `POST /api/deliveries` n'incluait pas le lot dans `movement.allocations` (la base était correcte).
- 3 tests corrigés (nom de fournisseur trop court, refusé à raison par la validation).
- Option Mongoose dépréciée `new: true` remplacée par `returnDocument: "after"`.

### Modifié (comportement changé, à connaître)
- **`POST /api/stocks/:id/movements` n'accepte plus `IN`** : l'entrée en stock passe par une livraison. Types admis : OUT, RETURN, LOSS, BREAKAGE, ADJUSTMENT.
- `ADJUSTMENT` : responsable uniquement, `direction` (UP/DOWN) et justification de 10 caractères minimum obligatoires. LOSS et BREAKAGE : justification de 5 caractères minimum.
- `Stock.quantity` désigne désormais explicitement le stock **disponible** (hors périmé et quarantaine).
- `PATCH /api/stocks/:id` accepte les paramètres de réapprovisionnement (toujours jamais `quantity`).
- `POST /api/deliveries` : `lotNumber` + `expiryDate` ensemble ; produit périmé refusé ; `purchaseOrder` facultatif.
- Les lectures de lots et les évaluations d'alertes constatent les péremptions (écriture pendant une lecture).
- Fichiers d'origine non établie isolés dans `_unverified/` (voir `docs/PROVENANCE.md`).

### Modifié (2e étape, toujours valable)
- **Toutes les routes d'écriture exigent maintenant une connexion.** Lecture publique conservée pour `GET` médicaments et pharmacies.
- Médicaments : créer/modifier = admin ou responsable ; supprimer = admin.
- Pharmacies : créer/supprimer = admin ; modifier = admin ou responsable **de cette pharmacie**.
- Stocks : réservés au personnel (pharmacien, responsable) et limités à leurs pharmacies ; créer/modifier/supprimer = responsable. **Un administrateur de plateforme n'a pas accès aux stocks.**
- Livraisons : personnel uniquement, limité à ses pharmacies.
- Les mouvements et livraisons enregistrent `performedBy`.
- `PATCH /api/stocks/:id` : refuse `quantity` (400). Utiliser `POST /api/stocks/:id/movements`.
- `DELETE /api/stocks/:id` : 409 si le stock a un historique.
- `POST /api/stocks` : le stock est créé à 0 ; une quantité initiale génère un mouvement "Stock initial".
- `POST /api/deliveries` : en-tête optionnel `Idempotency-Key` ; erreurs au format `{message, code, details?}`.
- `GET` listes stocks/livraisons : pagination `?page=&limit=` (défaut 50, max 100), total dans `X-Total-Count`.
- `GET /api/health` : 503 si la base est déconnectée.
- `POST /api/stocks` et `POST /api/deliveries` : identifiants et quantités validés (entiers > 0).
- Fins de ligne des fichiers réécrits : LF (les fichiers d'origine étaient en CRLF).

### Limites connues
- Pas encore : notifications externes (courriel/SMS), registre de destruction des lots, stock réservé, réconciliation automatique, planificateur de tâches, récupération de mot de passe, vérification d'e-mail, gestion des rôles/affectations après création (modifier ou désactiver un compte), limitation de débit par IP, CORS.
- Un responsable peut modifier tous les champs de sa pharmacie (dont `isActive`).
- Non testé sur une vraie base dans mon environnement : voir README.
- Un arrêt du processus entre la modification du stock et la validation du mouvement laisse un mouvement PENDING (détectable ; réconciliation à écrire).
