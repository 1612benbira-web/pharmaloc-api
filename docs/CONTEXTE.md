# PharmaLoc : contexte du projet (à donner à tout assistant)

Dernière mise à jour : 2026-10-06. État : 331 tests verts côté API ; trois interfaces web fonctionnelles en développement.
Si ce document contredit ce que tu vois dans le code, **le code fait foi** : demande les fichiers, ne devine pas.

## 1. Objectif

PharmaLoc est une plateforme pour le Sénégal : un patient cherche un médicament, voit quelles pharmacies l'ont,
le commande en retrait ou en livraison à domicile, et le paie. Les pharmacies gèrent leurs stocks, leurs lots
(péremption), leurs fournisseurs et préparent les commandes. Des livreurs rattachés à une pharmacie livrent à domicile.
Un administrateur gère les comptes, le catalogue de médicaments et les pharmacies.

## 2. Règles impératives pour tout assistant

1. **Ne jamais remplacer un fichier existant sans avoir vu son contenu actuel.** Demande-le d'abord.
   Un `User.js` a déjà été écrasé par du code venant d'un autre contexte, ce qui a cassé l'authentification.
2. **Ne pas réécrire l'authentification.** Elle existe : sessions en base, cookie `pl_session`, mots de passe en scrypt.
   Pas de JWT, pas de bcrypt, pas de champ `password` : le modèle utilise `passwordHash`.
3. Garder tous les tests au vert (`npm run test:all`). Chaque nouvelle fonctionnalité apporte ses tests.
4. Donner les fichiers **complets** (pas de fragments), dans le style existant : CommonJS côté API, messages en français,
   `AppError`, validation zod.
5. **Aucun secret dans une conversation** : ni mot de passe de base, ni clé d'API, ni contenu du `.env`.
6. Ne jamais stocker de numéro de carte, de CVV ni de code secret Mobile Money.
7. Le **client n'envoie jamais** un prix, un total, un rôle ou un montant : tout est calculé ou lu côté serveur.
8. Ne rien modifier sur une base de production sans sauvegarde. Les tests utilisent une base en mémoire et ne touchent jamais la vraie base.
9. Ne pas saisir d'accents dans PowerShell ou mongosh pour créer des données : ils s'enregistrent abîmés. Passer par le site ou par l'API.

## 3. Dépôts et environnement

Deux dépôts GitHub séparés :
- `pharmaloc-api` : l'API (`C:\Users\BEN BIRAMA\pharmaloc-api`, port 3000).
- `pharmaloc-web` : le site (`C:\Users\BEN BIRAMA\pharmaloc-web`, port 5173).

Environnement : Windows, PowerShell, Node.js v26.3.0, npm 11.16.0. **MongoDB local** 7.0.43
(`mongodb://127.0.0.1:27017`, base `pharmaloc`), **pas Atlas**, sans contrôle d'accès (développement). mongosh 2.12.0.
Le `.env` n'est jamais versionné.

Commandes API : `npm run dev` (serveur avec nodemon), `npm run test:all` (tous les tests), `npm run create-admin`
(premier administrateur), `node scripts/createStaff.js` (compte de personnel ou livreur de développement, variables
`STAFF_*`, voir l'en-tête du script), `node scripts/checkDb.js` (vérifie la connexion MongoDB, n'affiche aucun secret).
Commandes site : `npm run dev`, `npm run build`.

Pour développer, il faut **les deux serveurs lancés dans deux fenêtres**. Le site relaie `/api` vers l'API
(proxy Vite, sans `changeOrigin`) ; le `.env` de l'API doit contenir
`ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174`, car le contrôle CSRF compare `Origin` et `Host`.
Un navigateur ne garde **qu'une session par site** : pour tester plusieurs rôles en même temps, utiliser une fenêtre
privée et un autre navigateur.

## 4. Stack et sécurité

**API** : Express 5 (les erreurs async sont transmises automatiquement à `errorHandler`), Mongoose 9, zod 4,
vitest 5, supertest, mongodb-memory-server. **Site** : React 19, React Router 7, Vite 7, CSS simple, aucune bibliothèque d'état.

Sécurité en place :
- Sessions révocables en base (seul le hash SHA-256 du jeton est stocké), cookie HttpOnly + SameSite=Lax, `Secure` en production.
- Contrôle d'origine contre le CSRF (`originCheck`), CORS en liste blanche (`ALLOWED_ORIGINS`), en-têtes de sécurité (`no-store`, `nosniff`, HSTS en production).
- Verrouillage du compte après 5 échecs de connexion ou de changement de mot de passe. Réponse identique pour e-mail inconnu et mauvais mot de passe.
- Limitation de débit en mémoire (connexion, inscription, globale), désactivée pendant les tests.
- Au plus 5 commandes en attente de paiement par patient.
- En production, le serveur refuse de démarrer si la configuration est dangereuse (`checkProductionConfig`).
- Mot de passe : 10 caractères minimum. Le changer ferme toutes les autres sessions.
- Un compte créé par un admin a un mot de passe provisoire (`mustChangePassword`) : l'API refuse tout sauf lire son profil, changer le mot de passe et se déconnecter.

## 5. Structure de l'API

```
src/
  app.js            fabrique l'application (utilisée par les tests)
  server.js         démarre le serveur (vérifie la config en production, arrêt propre)
  config/           env.js, database.js
  controllers/      logique des routes
  domain/           règles métier PURES, sans base de données
  middlewares/      auth (authenticate, requireRole), validate, errorHandler, originCheck, cors, rateLimit, securityHeaders
  models/           schémas Mongoose
  routes/           ordre : authenticate, rôle, validation, contrôleur
  services/         accès base et opérations composées
  utils/            AppError
  validators/       schémas zod
scripts/            createAdmin.js, createStaff.js, checkDb.js
tests/unit/         sans base de données
tests/integration/  base en mémoire, vraies sessions via /api/auth/login
docs/               documentation
_unverified/        code mis de côté, non branché et jamais relu : ne pas s'y fier
```

Conventions : réponses d'erreur `{ message, code, details? }`, listes paginées avec l'en-tête `X-Total-Count`,
clé d'idempotence dans `Idempotency-Key` (8 à 100 caractères), validation zod dans `req.valid`.

Structure du site : `src/api.js` (client), `src/auth.jsx` (session), `src/App.jsx` (routes et garde par rôle),
`src/pages/` (une page par écran), `src/admin.js` (hook d'actions de l'administration).

## 6. Rôles

| Rôle | Peut |
| --- | --- |
| `patient` | s'inscrire, chercher (`/api/catalog`), commander, payer, suivre sa commande et sa livraison |
| `pharmacist` | lire stocks et lots de ses pharmacies, enregistrer mouvements et réceptions, quarantaine, fournisseurs (lecture), commandes fournisseur (brouillon, soumission), alertes, préparer les commandes patient |
| `pharmacy_manager` | tout ce que fait le pharmacien, plus : créer et modifier stocks (dont le prix) et fournisseurs, corrections d'inventaire, libérer un lot, approuver et envoyer les commandes fournisseur, régler sa pharmacie, proposer un médicament (par l'API seulement) |
| `courier` | prendre, récupérer et livrer les courses des pharmacies auxquelles il est affecté. Aucun accès aux stocks ni aux prix |
| `admin` | créer, lister, suspendre et réactiver les comptes du personnel et des livreurs ; gérer le catalogue de médicaments et les pharmacies. **Pas d'accès aux stocks privés** ; ne voit pas les patients ; ne peut pas se suspendre lui-même |

Le personnel et les livreurs sont rattachés à des pharmacies (`user.pharmacies`). Tout est **cloisonné par pharmacie** :
une ressource d'une autre pharmacie répond 404 (jamais 403), pour ne rien révéler.

## 7. Modèles principaux

- `User` : name, email, passwordHash (`select: false`), role, pharmacies, isActive, mustChangePassword, failedLoginCount, lockUntil.
- `Session`, `AuditLog`.
- `Medicine` : catalogue **commun** à toutes les pharmacies. `prescriptionRequired` bloque la commande en ligne. `isActive: false` = invisible et non commandable.
- `Pharmacy` : coordonnées, `publishAvailability`, `publishQuantities`, `isActive` (admin seulement).
- `Stock` (pharmacie + médicament) : `quantity` = stock **disponible à la vente**, `price` en FCFA, `minimumQuantity`.
- `StockMovement` : seul moyen de modifier une quantité. `Lot` : numéro, péremption, quantité restante, état OK / QUARANTINE / EXPIRED.
- `Delivery` : **réception de marchandise d'un fournisseur** (rien à voir avec la livraison au client).
- `Supplier`, `PurchaseOrder` (commande **fournisseur** : elle n'augmente jamais le stock), `Alert`.
- `Order` (commande **patient**), `Payment`, `Shipment` (course de livraison au client).

## 8. Règles métier à respecter

**Stock** : une quantité ne change que par un mouvement (`applyMovement`, ou `recordMovement` pour les sorties avec lots).
Le `$inc` conditionnel garantit qu'aucune vente concurrente ne rend le stock négatif. Les sorties suivent le FEFO.
Les péremptions sont constatées à la lecture et avant chaque sortie, sans planificateur.

**Commandes** : le stock est **réservé à la création** et remis en vente si la commande est annulée ou expire (30 minutes sans paiement).
Le prix vient de `Stock.price`. Un produit sans prix, désactivé ou sur ordonnance ne se commande pas.
Statuts : PAYMENT_PENDING, CONFIRMED, PREPARING, READY, OUT_FOR_DELIVERY, COMPLETED, CANCELLED, EXPIRED.
Une commande en livraison exige adresse et téléphone ; le personnel ne peut pas poser OUT_FOR_DELIVERY ni COMPLETED dessus.

**Paiement** : une couche `paymentProviders` isole le prestataire. **Seul un prestataire simulé existe**, désactivé en production
(erreur 501). Les simulateurs (`/api/payments/:id/simulate` pour l'admin, `/api/payments/order/:orderId/simulate` pour le patient)
n'existent pas en production. Un seul paiement ouvert par commande. Un paiement reçu sur une commande déjà expirée est marqué `needsReview`.

**Livraison** : quand la commande passe READY, une course PENDING est créée avec un code de remise à 6 chiffres, visible **seulement** du patient.
Le livreur la prend, la récupère, puis la clôt avec ce code (5 essais maximum). En cas d'échec : nouvelle course (3 tentatives maximum).

**Catalogue** : un responsable **propose** un médicament (créé inactif et soumis à ordonnance) ; seul un admin le valide, le modifie ou le supprime.
Une pharmacie ou un médicament utilisé se désactive, il ne se supprime pas.

## 9. Routes de l'API

`/api/health`, `/api/auth` (dont `change-password`), `/api/admin` (`users`, `users/:id/status`), `/api/medicines`, `/api/pharmacies`,
`/api/stocks` (dont `/:id/movements`), `/api/deliveries` (réceptions fournisseur), `/api/lots`, `/api/suppliers`, `/api/purchase-orders`,
`/api/replenishment`, `/api/alerts`, `/api/orders`, `/api/payments`, `/api/catalog` (recherche patient), `/api/shipments`.
La lecture des médicaments et des pharmacies exige d'être connecté.

## 10. Limites connues et chantiers restants

- **Paiement réel** : à intégrer (Wave, Orange Money ou un agrégateur) avec webhook signé et vérification du montant. Sans lui, personne ne peut payer en production.
- **Remboursements** et annulation d'une commande payée : non gérés. Après 3 échecs de livraison, la commande reste READY et la pharmacie doit intervenir.
- **Réconciliation** : un arrêt brutal du serveur entre deux étapes d'une opération composée peut laisser un écart détectable ; aucune tâche de réconciliation n'est écrite.
- **Journal d'audit** : seule la création de compte est journalisée ; les suspensions et validations d'administration ne le sont pas (`AuditLog.js` à relire avant d'ajouter des actions).
- Pas de « mot de passe oublié » par e-mail, pas de notifications, pas de statistiques.
- Pas d'écran pour qu'un responsable propose un médicament (l'API le permet).
- Le site n'a pas de tests automatisés.
- **Mise en ligne** : hébergement, HTTPS, base MongoDB authentifiée avec sauvegardes, `TRUST_PROXY`, déploiement du site avec relais `/api` (voir `docs/DEPLOIEMENT.md`).
- Aspects juridiques : données de santé et personnelles, à faire vérifier par un juriste.
- Géolocalisation calculée en mémoire (500 candidats au plus) : prévoir un index `2dsphere` à plus grande échelle.
- Pas encore de suivi GPS, de paiement à la livraison, d'OCR des bons de livraison, ni d'assistant IA.
  Un assistant IA ne devra jamais poser de diagnostic ni remplacer un pharmacien.

## 11. Façon de travailler

1. Demander les fichiers concernés avant de les modifier.
2. Expliquer ce qui change et pourquoi, puis donner les fichiers complets et leurs tests.
3. Lancer `npm run test:all`, puis un `git commit` à chaque point stable et un `git push` (dans chacun des deux dépôts).
