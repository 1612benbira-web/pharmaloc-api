# Modèle de stock de PharmaLoc

## Notions (cahier des charges, section 7.1)
| Notion | Où / comment | État |
|---|---|---|
| Stock **disponible** | `Stock.quantity` : ce qui peut être vendu (hors lots périmés ou en quarantaine) | Implémenté |
| Stock **en quarantaine** | Somme des lots `QUARANTINE` (`GET /api/stocks/:id/summary`) | Implémenté |
| Stock **périmé** | Somme des lots `EXPIRED` | Implémenté |
| Stock **physique** | disponible + quarantaine + périmé | Implémenté (calculé) |
| Stock **commandé** | Reste à recevoir des commandes `APPROVED`, `SENT`, `PARTIALLY_RECEIVED` | Implémenté (calculé, n'augmente jamais le stock) |
| Stock **réservé** | - | **Non implémenté** (renvoyé `null`) |
| Stock **en cours de réception** | - | **Non implémenté** (renvoyé `null`) |

## Règles
- `quantity` ne change que par un **mouvement** traçable (`StockMovement`) : jamais par PATCH.
- L'entrée en stock ne se fait que par **livraison** (ou retour autorisé `RETURN`, ou correction `ADJUSTMENT UP` du responsable avec justification).
- Types : `IN` (livraison), `OUT` (vente), `RETURN`, `LOSS`, `BREAKAGE`, `ADJUSTMENT` (UP/DOWN), et, internes aux lots, `EXPIRY`, `QUARANTINE`, `RELEASE`.
- Justification écrite obligatoire : `ADJUSTMENT` (10 car.), `LOSS` et `BREAKAGE` (5 car.).
- Chaque mouvement porte : avant/après, delta signé, utilisateur, clé d'idempotence, statut (`PENDING`, `APPLIED`, `REJECTED`). Les refus sont conservés.

## Lots et FEFO
- Un lot n'existe que si la livraison donne **numéro de lot ET date de péremption** (l'un sans l'autre est refusé : rien n'est deviné).
- Un produit **déjà périmé** est refusé à la réception. Un lot bloqué (quarantaine, périmé) ne peut pas recevoir de nouvelles unités.
- Sorties (`OUT`, `LOSS`, `BREAKAGE`, `ADJUSTMENT DOWN`) : répartition **FEFO** sur les lots vendables (actifs, non périmés), le plus proche de la péremption d'abord. Le reste vient du stock « sans lot ».
- **Péremption** : pas de planificateur. Elle est constatée **avant chaque sortie** et **à chaque évaluation d'alertes ou liste de lots** : les unités échues quittent le stock disponible (mouvement `EXPIRY`, idempotent) et le lot passe `EXPIRED`.
- **Quarantaine** : le lot sort immédiatement du disponible. Tout pharmacien peut la déclencher ; seul le responsable peut libérer (et jamais un lot périmé).
- Les unités `EXPIRED`/`QUARANTINE` restent comptées « physiques » jusqu'à destruction : **le registre de destruction n'est pas implémenté**.

## Commandes fournisseurs
`DRAFT → PENDING_APPROVAL → APPROVED → SENT`, `CANCELLED` (motif obligatoire). Approuver, envoyer et annuler une commande engagée : responsable. `PARTIALLY_RECEIVED` et `RECEIVED` sont posés **uniquement par les réceptions** rattachées (`purchaseOrder` dans la livraison). La réception n'enregistre que la quantité réellement livrée ; un produit absent de la commande est refusé.
**L'envoi au fournisseur est manuel** : passer en `SENT` ne contacte personne.

## Réapprovisionnement (déterministe)
`cible effective = max(stock cible, demande × délai × (1 + marge) + stock de sécurité)`
`brut = cible effective - disponible - déjà commandé` ; puis commande minimale ; puis arrondi **vers le haut** au conditionnement.
La demande est estimée sur les **ventes** (`OUT`) des 30 derniers jours et **seulement** si l'historique est suffisant (≥ 14 jours et ≥ 5 ventes) ; sinon la suggestion repose sur le stock cible et le dit. Sans cible ni historique : aucune suggestion. Pas de saisonnalité. Les quantités d'un brouillon généré viennent du serveur, pas du client.

## Alertes
Règles : rupture, stock sous le seuil (strict), rupture probable (demande connue, aucune commande en route), lot proche de péremption (30 j) ou périmé, écart d'inventaire (lots actifs > disponible, ou gros ajustement négatif), commande en attente de validation, livraison en retard. Une alerte = un incident : index unique `(pharmacie, clé)`. Réévaluer met à jour, **résout** ce qui a disparu et **rouvre** ce qui réapparaît. Aucune notification externe (courriel/SMS) n'est envoyée à ce stade.

## Limites connues (honnêtes)
1. Sans transactions MongoDB, une interruption du processus en plein traitement peut laisser un mouvement `PENDING` ou un lot non décrémenté. C'est **détectable** (alerte `INVENTORY_DISCREPANCY`, champ `consistent` de la synthèse). Une procédure de réconciliation reste à écrire.
2. Sous forte concurrence, une quarantaine simultanée à une vente du même lot peut créer un écart transitoire, signalé par l'alerte ci-dessus.
3. Les tests d'intégration MongoDB n'ont **pas** pu être exécutés dans l'environnement de développement de l'assistant (binaire MongoDB inaccessible). Ils doivent être lancés : `npm run test:integration`.
