# Origine du code (à jour au 30/09/2026)

Document destiné au dossier CADEV : distinguer l'antérieur du nouveau, et déclarer ce qui est d'origine non établie.

## 1. Code préexistant (archive `pharmaloc-api.zip` fournie par le porteur du projet)
Modèles Medicine, Pharmacy, Stock, Delivery, StockMovement (v1), contrôleurs/routes medicines, pharmacies, stocks, deliveries (v1), `server.js` et `config/database.js` d'origine.

## 2. Nouveau code de cette version
Tout ce qui figure dans `CHANGELOG.md` sous « Nouveau » : auth, sessions, rôles, validation, service de mouvements idempotents, lots, FEFO, alertes, fournisseurs, commandes, réapprovisionnement, domaine pur (`src/domain`), tests.

## 3. Fichiers d'origine NON ÉTABLIE (mis de côté)
Le 30/09/2026 à 04:42, des fichiers sont apparus dans le dossier de travail sans correspondre à une action journalisée de l'assistant ni à l'archive d'origine :
`src/models/{Supplier,PurchaseOrder,MedicineLot}.js`, `src/constants/movements.js`, `src/services/{alertRules,lotRules,availabilityRules,replenishmentRules}.js`, `src/services/stockService.js.new`.
Ils portent une conception concurrente (statut `SUBMITTED`, types `ADJUSTMENT_UP/DOWN`, `tracksLots`) et n'ont jamais été testés.
**Décision :** ils n'ont pas été adoptés. Déplacés (non supprimés) dans `_unverified/`, hors de `src/`, donc **inactifs**. À supprimer ou à réexaminer par le porteur du projet une fois leur auteur identifié.

Des champs optionnels ont aussi été trouvés dans des modèles existants et **conservés après revue** (additifs, sans risque, conformes au cahier des charges) :
- `Pharmacy` : `openingHours`, `publishAvailability`, `publishQuantities` (quantités exactes privées par défaut).
- `Medicine` : `activeIngredient`, `packaging`, `sourceReference`, `isActive` + index.
- `Stock` : paramètres de réapprovisionnement (`targetQuantity`, `leadTimeDays`, `safetyStock`, `minOrderQuantity`, `packSize`). Le champ `tracksLots` a été **retiré** (contredisait le modèle retenu).

**Question ouverte pour le porteur du projet :** ces fichiers et champs viennent-ils de vous, d'un autre outil, ou d'une autre session ? Tant que ce n'est pas clarifié, ne les présentez pas au jury comme créés dans le cadre du concours.

## 4. Dépendances
Exécution : express, mongoose, zod, dotenv. Développement : vitest, supertest, mongodb-memory-server, nodemon. Licences à vérifier et à consigner dans `LICENSES.md` (non encore écrit).
