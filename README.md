# PharmaLoc API

API Node.js / Express / MongoDB pour PharmaLoc AI (Sénégal). Voir `docs/AUDIT.md` et `CHANGELOG.md`.

## Installation (Windows PowerShell)
```powershell
npm install
Copy-Item .env.example .env
npm run dev
```
Vérification : `Invoke-RestMethod http://localhost:3000/api/health`

## Tests
```powershell
npm test                    # unitaires, sans base de données
npm run test:integration    # base MongoDB en mémoire, isolée (1er lancement : télécharge mongod)
```
Les tests n'utilisent jamais la base `pharmaloc`.

## Modifier un stock
Les quantités ne se modifient que par des mouvements :
```powershell
$body = @{ type = "OUT"; quantity = 2; reason = "Vente" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/stocks/<ID_STOCK>/movements `
  -ContentType "application/json" -Headers @{ "Idempotency-Key" = "vente-0001-abcdef" } -Body $body
```
Rejouer la même clé n'applique pas l'opération deux fois.

## Premier administrateur
```powershell
$env:ADMIN_EMAIL = "admin@exemple.sn"
$env:ADMIN_PASSWORD = "choisissez-un-mot-de-passe-de-10-caracteres-minimum"
npm run create-admin
Remove-Item Env:ADMIN_PASSWORD
```
L'admin crée ensuite les pharmaciens via `POST /api/admin/users` (rôle + pharmacies affectées).

## Se connecter (PowerShell)
```powershell
$body = @{ email = "moussa@exemple.sn"; password = "..." } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login `
  -ContentType "application/json" -Body $body -SessionVariable session
# Réutiliser la session pour les appels suivants :
Invoke-RestMethod http://localhost:3000/api/auth/me -WebSession $session
```

## Modules de stock (connecté en tant que personnel de pharmacie)
| Besoin | Route |
|---|---|
| Synthèse d'un stock (disponible, quarantaine, périmé, physique) | `GET /api/stocks/:id/summary` |
| Lots (avec classification) | `GET /api/lots?pharmacy=...` |
| Mise en quarantaine / libération (responsable) | `POST /api/lots/:id/quarantine` · `/release` avec `{ "reason": "..." }` |
| Fournisseurs | `GET/POST /api/suppliers`, `PATCH /api/suppliers/:id` |
| Suggestions de réapprovisionnement | `GET /api/replenishment/suggestions?pharmacy=...` |
| Brouillon de commande depuis les suggestions | `POST /api/purchase-orders/from-suggestions` |
| Workflow de commande | `POST /api/purchase-orders/:id/transition` avec `{ "to": "APPROVED" }` |
| Évaluer les alertes (constate aussi les péremptions) | `POST /api/alerts/evaluate` avec `{ "pharmacy": "..." }` |
| Réceptionner avec lot | `POST /api/deliveries` avec `lotNumber`, `expiryDate`, `purchaseOrder` (facultatif) |

Règles détaillées et limites : `docs/STOCK_MODEL.md`. Origine du code : `docs/PROVENANCE.md`.
