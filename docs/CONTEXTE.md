# PharmaLoc : contexte du projet (à donner à tout assistant)

Dernière mise à jour : 2026-10-03. État : 287 tests verts.
Si ce document contredit ce que tu vois dans le code, **le code fait foi** : demande les fichiers, ne devine pas.

## 1. Objectif

PharmaLoc est une plateforme pour le Sénégal : un patient cherche un médicament, voit quelles pharmacies l'ont,
le commande en retrait ou en livraison à domicile, et le paie. Les pharmacies gèrent leurs stocks, leurs lots
(péremption), leurs fournisseurs et préparent les commandes. Des livreurs rattachés à une pharmacie livrent à domicile.

Le backend est la priorité. Il n'y a pas encore de frontend.

## 2. Règles impératives pour tout assistant

1. **Ne jamais remplacer un fichier existant sans avoir vu son contenu actuel.** Demande-le d'abord.
   Un `User.js` a déjà été écrasé par du code venant d'un autre contexte, ce qui a cassé l'authentification.
2. **Ne pas réécrire l'authentification.** Elle existe : sessions en base, cookie `pl_session`, mots de passe en scrypt.
   Pas de JWT, pas de bcrypt, pas de champ `password` : le modèle utilise `passwordHash`.
3. Garder tous les tests au vert (`npm run test:all`). Chaque nouvelle fonctionnalité apporte ses tests.
4. Donner les fichiers **complets** (pas de fragments), dans le style existant : CommonJS, messages en français,
   `AppError`, validation zod.
5. **Aucun secret dans une conversation** : ni mot de passe de base, ni clé d'API, ni contenu du `.env`.
6. Ne jamais stocker de numéro de carte, de CVV ni de code secret Mobile Money.
7. Le **client n'envoie jamais** un prix, un total, un rôle ou un montant : tout est calculé ou lu côté serveur.
8. Ne rien modifier sur la base de production sans sauvegarde. Les tests utilisent une base en mémoire et ne touchent jamais la vraie base.

## 3. Environnement

- Windows, PowerShell. Node.js v26.3.0, npm 11.16.0.
- **MongoDB local** 7.0.43 : `mongodb://127.0.0.1:27017`, base `pharmaloc`. **Pas Atlas.** Pas de contrôle d'accès activé (développement).
- mongosh 2.12.0.
- Dépôt GitHub : `1612benbira-web/pharmaloc-api` (branche `master`). Le `.env` n'est jamais versionné.
- Commandes : `npm run dev` (serveur avec nodemon, http://localhost:3000), `npm run test:all` (tous les tests),
  `npm test` (unitaires), `npm run create-admin` (premier administrateur, voir `scripts/createAdmin.js`),
  `node scripts/checkDb.js` (vérifie la connexion MongoDB, n'affiche aucun secret).

## 4. Stack

Express 5 (les erreurs async sont transmises automatiquement à `errorHandler`), Mongoose 9, zod 4,
vitest 5, supertest, mongodb-memory-server. Pas de JWT.

Sécurité en place : sessions révocables en base (seul le hash SHA-256 du jeton est stocké), cookie HttpOnly + SameSite=Lax,
contrôle d'origine contre le CSRF (`originCheck`), verrouillage du compte après 5 échecs de connexion,
réponse identique pour e-mail inconnu et mauvais mot de passe.

## 5. Structure

```
src/
  app.js            fabrique l'application (utilisée par les tests)
  server.js         démarre le serveur
  config/           env.js, database.js
  controllers/      logique des routes
  domain/           règles métier PURES, sans base de données (stockMath, orderFlow, shipmentFlow, catalogRules...)
  middlewares/      auth (authenticate, requireRole), validate, errorHandler, originCheck
  models/           schémas Mongoose
  routes/           déclaration des routes, ordre : authenticate, rôle, validation, contrôleur
  services/         accès base et opérations composées (stockService, lotService, orderService...)
  utils/            AppError
  validators/       schémas zod
scripts/            createAdmin.js, checkDb.js
tests/unit/         sans base de données
tests/integration/  base en mémoire, vraies sessions via /api/auth/login
docs/               documentation
_unverified/        code mis de côté, non branché et jamais relu : ne pas s'y fier
```

Conventions : réponses d'erreur `{ message, code, details? }`, messages en français, listes paginées avec l'en-tête
`X-Total-Count`, clé d'idempotence dans l'en-tête `Idempotency-Key` (8 à 100 caractères), validation zod dans `req.valid`.

## 6. Rôles

| Rôle | Peut |
| --- | --- |
| `patient` | s'inscrire, chercher (`/api/catalog`), commander, payer, suivre sa commande et sa livraison |
| `pharmacist` | lire stocks et lots de ses pharmacies, enregistrer mouvements et réceptions, quarantaine, fournisseurs (lecture), commandes fournisseur (brouillon, soumission), alertes, préparer les commandes patient |
| `pharmacy_manager` | tout ce que fait le pharmacien, plus : créer et modifier stocks et fournisseurs, corrections d'inventaire, libérer un lot, approuver et envoyer les commandes fournisseur, régler sa pharmacie, proposer un médicament |
| `courier` | prendre, récupérer et livrer les courses des pharmacies auxquelles il est affecté. Aucun accès aux stocks ni aux prix |
| `admin` | créer les comptes du personnel et des livreurs, gérer le catalogue de médicaments et les pharmacies. **Pas d'accès aux stocks privés par défaut** |

Le personnel et les livreurs sont rattachés à des pharmacies (`user.pharmacies`). Tout est **cloisonné par pharmacie** :
une ressource d'une autre pharmacie répond 404 (jamais 403), pour ne rien révéler.

## 7. Modèles principaux

- `User` : name, email, passwordHash (`select: false`), role, pharmacies, isActive, failedLoginCount, lockUntil.
- `Session`, `AuditLog`.
- `Medicine` : catalogue **commun** à toutes les pharmacies. `prescriptionRequired` bloque la commande en ligne. `isActive: false` = invisible et non commandable.
- `Pharmacy` : coordonnées, `publishAvailability` (visible dans la recherche patient), `publishQuantities` (quantités exactes visibles), `isActive` (admin seulement).
- `Stock` (pharmacie + médicament) : `quantity` est le stock **disponible à la vente** (hors lots périmés ou en quarantaine), `price` en FCFA, `minimumQuantity`.
- `StockMovement` : seul moyen de modifier une quantité. Types IN, OUT, ADJUSTMENT, RETURN, LOSS, BREAKAGE, EXPIRY, QUARANTINE, RELEASE.
- `Lot` : numéro, péremption, quantité restante, état OK / QUARANTINE / EXPIRED.
- `Delivery` : **réception de marchandise d'un fournisseur** (rien à voir avec la livraison au client).
- `Supplier`, `PurchaseOrder` (commande **fournisseur** : elle n'augmente jamais le stock), `Alert`.
- `Order` (commande **patient**), `Payment`, `Shipment` (course de livraison au client).

## 8. Règles métier à respecter

**Stock**
- Une quantité ne change que par un mouvement (`applyMovement`, ou `recordMovement` pour les sorties avec lots).
  Le `$inc` conditionnel garantit qu'aucune vente concurrente ne rend le stock négatif.
- Les sorties se répartissent sur les lots en FEFO (le plus proche de la péremption d'abord). Les péremptions sont constatées
  à la lecture et avant chaque sortie, sans planificateur.

**Commandes patient**
- Le stock est **réservé à la création** de la commande (sortie `OUT`) et remis en vente si la commande est annulée ou expire (30 minutes sans paiement).
- Le prix vient de `Stock.price`. Un produit sans prix, désactivé ou sur ordonnance ne se commande pas.
- Statuts : PAYMENT_PENDING, CONFIRMED, PREPARING, READY, OUT_FOR_DELIVERY, COMPLETED, CANCELLED, EXPIRED.
- Une commande en livraison exige adresse et téléphone. Le personnel ne peut pas poser OUT_FOR_DELIVERY ni COMPLETED sur une livraison : c'est le livreur, avec le code.

**Paiement**
- Une couche `paymentProviders` isole le prestataire. **Seul un prestataire simulé existe**, désactivé en production
  (erreur 501 `PAYMENT_PROVIDER_NOT_CONFIGURED`), et l'endpoint de simulation n'est pas monté en production.
- Un seul paiement ouvert par commande (index unique partiel). Un paiement reçu sur une commande déjà expirée est marqué `needsReview` (remboursement à traiter).

**Livraison à domicile**
- Quand la commande passe READY, une course PENDING est créée avec un code de remise à 6 chiffres.
  Le livreur la prend, la récupère, puis la clôt avec le code donné par le patient (5 essais maximum).
- Le code n'est visible **que** par le patient. En cas d'échec, nouvelle course (3 tentatives maximum).

**Catalogue**
- Un responsable de pharmacie **propose** un médicament : il est créé inactif et soumis à ordonnance, jusqu'à validation par un admin.
  Seul un admin modifie ou supprime le catalogue. Une pharmacie ou un médicament utilisé se désactive, il ne se supprime pas.

## 9. Routes

`/api/health`, `/api/auth`, `/api/admin`, `/api/medicines`, `/api/pharmacies`, `/api/stocks` (dont `/:id/movements`),
`/api/deliveries` (réceptions fournisseur), `/api/lots`, `/api/suppliers`, `/api/purchase-orders`,
`/api/replenishment`, `/api/alerts`, `/api/orders`, `/api/payments`, `/api/catalog` (recherche patient),
`/api/shipments`.

La lecture des médicaments et pharmacies exige d'être connecté.

## 10. Limites connues et chantiers restants

- **Paiement réel** : à intégrer (Wave, Orange Money ou un agrégateur) avec webhook signé et vérification du montant.
- **Remboursements** et annulation d'une commande payée : non gérés. Après 3 échecs de livraison, la commande reste READY et la pharmacie doit intervenir.
- **Réconciliation** : un arrêt brutal du serveur entre deux étapes d'une opération composée (mouvement de stock, annulation de commande,
  création de course) peut laisser un écart détectable. Aucune tâche de réconciliation n'est écrite.
- **Avant toute mise en ligne** : limitation de débit (connexion, inscription), CORS pour un frontend séparé,
  configuration de production (`NODE_ENV=production`, `ALLOWED_ORIGINS`, cookies sécurisés), authentification de MongoDB (ou Atlas), sauvegardes.
- Géolocalisation calculée en mémoire (500 candidats au plus) : prévoir un index `2dsphere` à plus grande échelle.
- Pas encore de frontend, de notifications, de suivi GPS, de paiement à la livraison, d'OCR des bons de livraison, d'assistant IA.
  Un assistant IA ne devra jamais poser de diagnostic ni remplacer un pharmacien ; les données de santé exigent un soin particulier.

## 11. Façon de travailler

1. Demander les fichiers concernés avant de les modifier.
2. Expliquer ce qui change et pourquoi, puis donner les fichiers complets et leurs tests.
3. Lancer `npm run test:all`, puis un `git commit` à chaque point stable et un `git push`.
