# Audit initial de pharmaloc-api (état au 30/09/2026)

Source : archive `pharmaloc-api.zip` (sans `.env` ni `.git` : rien à masquer, pas d'historique consultable).

## Existant (v1, antérieur à cette version)
Express 5.2.1 + Mongoose 9.10.2, CommonJS. 5 modèles (Medicine, Pharmacy, Stock, Delivery, StockMovement),
CRUD medicines / pharmacies / stocks, création de livraison qui augmente le stock, aucun test.

## Constats (par gravité)
| # | Constat | Fichier(s) | Statut |
|---|---------|-----------|--------|
| 1 | **Aucune authentification ni rôle** : toute route est publique (lecture/modif/suppression des stocks) | toutes les routes | CORRIGÉ (sessions serveur, rôles, cloisonnement par pharmacie) - reste : récupération de mot de passe, vérification d'e-mail |
| 2 | Livraison **non atomique** : lecture, calcul, `save()` puis création du mouvement. Deux requêtes simultanées => perte de mise à jour ; un échec entre deux étapes => stock modifié sans trace | deliveryController | CORRIGÉ |
| 3 | **Aucune idempotence** : renvoyer la requête double le stock | deliveryController | CORRIGÉ (en-tête `Idempotency-Key`) |
| 4 | `PATCH /api/stocks/:id` permet de fixer `quantity` librement : contourne l'historique | stockController | CORRIGÉ (refusé, passer par un mouvement) |
| 5 | `DELETE` stock supprime sans conserver l'historique des mouvements | stockController | CORRIGÉ (409 si historique) |
| 6 | Réponses d'erreur exposent `error.message` interne | controllers, medicineRoutes | PARTIEL : corrigé pour stocks/livraisons ; medicines et pharmacies restent à migrer |
| 7 | `req.body` passé tel quel à `create`/`findByIdAndUpdate` (champs non prévus acceptés) | medicine/pharmacy | OUVERT |
| 8 | URI MongoDB et port codés en dur ; `process.exit` dans le module de connexion | database.js, server.js | CORRIGÉ |
| 9 | Pas de pagination (`find()` illimité) | tous les GET liste | CORRIGÉ pour stocks/livraisons/mouvements |
| 10 | Pas de CORS, rate limit, en-têtes de sécurité | server.js | OUVERT |
| 11 | Logique métier dans les routes (medicineRoutes) | medicineRoutes | OUVERT (incohérent avec les autres modules) |
| 12 | Types de mouvement limités à IN/OUT/ADJUSTMENT ; ADJUSTMENT impossible (quantité min 1, pas de signe) ; pas de lots, péremption, fournisseurs | StockMovement | CORRIGÉ en grande partie : ajustements signés et justifiés, lots, péremption FEFO, fournisseurs, commandes, alertes (voir docs/STOCK_MODEL.md) |

## Prérequis à confirmer
- MongoDB local : est-il un **replica set** ? (requis pour les transactions). Sinon on reste sur les opérations atomiques + idempotence, déjà en place.
- Version de Node sur ta machine (>= 20 requis par vitest 5).

## Ordre prévu
1. (fait) Socle : config, erreurs, validation, cohérence du stock, tests.
2. Migrer medicines/pharmacies vers validation + erreurs centralisées.
3. Authentification + rôles + appartenance pharmacie (bloque tout le reste côté sécurité).
4. Phase 3 : ajustements/inventaire signés, lots + péremption FEFO, alertes, fournisseurs, commandes, réapprovisionnement.
5. Frontend, puis IA/OCR, puis préparation CADEV.
