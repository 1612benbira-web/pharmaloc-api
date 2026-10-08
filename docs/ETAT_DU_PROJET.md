# PharmaLoc : état du projet (à donner à l'assistant à chaque nouvelle session)

Ce fichier dit **où on en est**. Son compagnon `CONTEXTE.md` dit **comment le projet est construit** et quelles règles respecter.
Donne les deux à l'assistant au début de chaque conversation : sans eux, il ne sait rien de ton projet.

Dernière mise à jour : 2026-10-07.

## 1. Comment utiliser ce fichier

**Au début d'une session**, colle `CONTEXTE.md`, puis ce fichier, puis ce message :

> Voici le contexte et l'état de mon projet PharmaLoc. Lis-les, résume en 5 lignes où on en est et ce qui reste à valider,
> puis attends mes consignes. Ne modifie aucun fichier sans m'avoir demandé de te le montrer d'abord.

**Pendant la session**, dis toujours à l'assistant quand un lot est validé (tests verts) ou quand une étape échoue,
en collant la sortie de `npm run test:all`.

**À la fin de la session**, demande :

> Mets à jour ETAT_DU_PROJET.md avec ce qu'on a fait, les résultats de tests et les prochaines étapes.

Remplace alors le fichier du dépôt (`pharmaloc-api\docs\ETAT_DU_PROJET.md`), puis `git add`, `git commit`, `git push`.

Règle d'or : **ne mets « validé » que ce que tu as toi-même vérifié** (tests verts collés dans la conversation, écran essayé).
Une fonctionnalité livrée mais non vérifiée est notée « à valider ».

## 2. Où on en est

PharmaLoc fonctionne **de bout en bout en développement**, avec un paiement simulé : un patient trouve un médicament, commande,
paie en mode test, la pharmacie prépare, le livreur livre avec le code de remise, l'administrateur gère comptes, catalogue et pharmacies.
La mise en production attend un vrai prestataire de paiement et l'hébergement.

### Validé (essayé et/ou tests verts confirmés)

| Domaine | Détail |
| --- | --- |
| API : base | authentification par sessions, rôles, cloisonnement par pharmacie, stocks, lots FEFO, mouvements, réceptions, fournisseurs, commandes fournisseur, alertes, réapprovisionnement |
| API : commandes patient | recherche, commande avec stock réservé, paiement simulé, préparation, annulation, expiration |
| API : livraison | courses, code de remise, échecs et nouvelles tentatives |
| API : sécurité | limitation de débit, CORS, en-têtes, contrôle de la configuration de production, 5 commandes en attente maximum |
| API : routes catalogue sécurisées | médicaments et pharmacies |
| API : administration | liste et suspension des comptes |
| API : mot de passe | changement par le titulaire, mot de passe provisoire à changer à la première connexion |
| Site | connexion, inscription, espace patient (recherche, commande, paiement test, suivi, code de remise), espace pharmacie (commandes, stocks, réceptions, prix), espace livreur, espace administrateur (médicaments, pharmacies, comptes), page « Mon compte » |

Dernier résultat de tests **confirmé** : **331 tests verts** (2026-10-06), commits `b6fc5c1` (API) et `3706818` (site), poussés.

### Livré, à valider (tests ou écrans non encore confirmés)

| Lot | Contenu | Tests attendus après |
| --- | --- | --- |
| Documentation | `docs/CONTEXTE.md`, `docs/DEPLOIEMENT.md` à copier dans le dépôt | sans objet |
| Remboursements | annulation d'une commande payée par le responsable, remboursement par le prestataire simulé, onglet « Paiements » de l'admin | 340 |
| Journal d'audit | journalisation des actions sensibles, onglet « Journal » de l'admin | 347 |
| Mot de passe oublié | e-mail avec lien à usage unique (30 minutes), pages « mot de passe oublié » et « nouveau mot de passe » | 355 |

Chaque lot : installer l'archive, `npm run test:all`, essayer les écrans, puis commit et push dans les deux dépôts.
Le journal et le mot de passe oublié s'appuient sur les remboursements : les installer **dans cet ordre**.

### À faire

1. Écran pour qu'un responsable **propose un médicament** (l'API existe : le médicament est créé inactif, l'admin le valide).
2. **Statistiques** pour les pharmacies (ventes, ruptures, produits qui se vendent le plus).
3. **Tests automatisés du site** (rien n'est testé automatiquement côté site).
4. **Vrai prestataire de paiement** (Wave, Orange Money ou un agrégateur) : en attente de ton compte marchand.
5. **Mise en ligne** : suivre `docs/DEPLOIEMENT.md`.
6. Plus tard : notifications, paiement à la livraison, suivi GPS, OCR des bons de livraison, assistant IA.

## 3. Dépôts et environnement

- `pharmaloc-api` : `C:\Users\BEN BIRAMA\pharmaloc-api`, port 3000. `pharmaloc-web` : `C:\Users\BEN BIRAMA\pharmaloc-web`, port 5173.
- GitHub : `1612benbira-web/pharmaloc-api` et `1612benbira-web/pharmaloc-web`, branche `master`.
- MongoDB **local** (`127.0.0.1:27017`, base `pharmaloc`), sans mot de passe : développement seulement.
- Comptes de test : un patient, un responsable et un livreur de « Pharmacie du Point E », un responsable de « Pharmacie Test », un admin
  (les mots de passe ne sont écrits nulle part dans le dépôt).
- Variables du `.env` de l'API à connaître : `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174`, `RATE_LIMIT`, `TRUST_PROXY`,
  et, pour le mot de passe oublié, `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

## 4. Décisions importantes (et pourquoi)

- **Deux dépôts séparés**, pas un monorepo : l'API est déjà sauvegardée avec son historique, et site et API se déploient différemment.
- **Authentification par sessions en base** (cookie `pl_session`), pas de JWT : sessions révocables, suspension immédiate d'un compte.
- **Le stock est réservé à la création de la commande** et remis en vente si elle est annulée ou expire : pas de vente de la dernière boîte à deux clients.
- **Le prix est toujours lu côté serveur** ; le client n'envoie jamais un montant.
- **Le code de remise n'est visible que du patient** : personne d'autre ne peut clore une livraison.
- **Un médicament proposé par un responsable est créé inactif** et soumis à ordonnance : seul un admin le publie.
- **Le prestataire de paiement est isolé** (`paymentProviders.js`) : seul un simulateur existe, désactivé en production.
- **Le site relaie `/api` vers l'API** (développement et production), pour garder une seule origine et le cookie de session simple.
- **Pas d'indication sur l'existence d'un compte** : connexion, mot de passe oublié et inscription ne doivent pas permettre de deviner qui est inscrit.

## 5. Journal des sessions

- **2026-10-03** : audit du projet existant ; restauration de `User.js` (écrasé par du code d'un autre contexte) ; commandes, paiement simulé, recherche patient,
  livraison, durcissement, sécurisation des routes médicaments et pharmacies ; premier dépôt GitHub.
- **2026-10-04** : application web (connexion, recherche patient, espace pharmacie) ; correction des accents abîmés dans la base (saisis depuis PowerShell).
- **2026-10-05** : commande et paiement test côté site, espace livreur, espace administrateur, changement de mot de passe ; parcours complet validé ;
  deux dépôts GitHub.
- **2026-10-06** : mot de passe provisoire obligatoire (331 tests verts), documentation `CONTEXTE.md` et `DEPLOIEMENT.md`, remboursements, journal d'audit.
- **2026-10-07** : mot de passe oublié par e-mail ; ce fichier d'état.

## 6. À faire de ton côté (hors code)

- Ouvrir un compte marchand chez un prestataire de paiement (Wave, Orange Money ou agrégateur) et obtenir sa documentation d'API.
- Choisir un hébergement (budget, région) et un nom de domaine.
- Choisir un service d'envoi d'e-mails (SMTP) pour le mot de passe oublié.
- Faire vérifier les aspects juridiques (données personnelles et de santé, vente de médicaments).
- Vérifier que les deux dépôts GitHub sont **privés**, et qu'aucun `.env` n'y figure.
- Sauvegarder régulièrement ta base de test si elle contient des données utiles.

## 7. Incidents et leçons

- **`User.js` écrasé** (2026-10-03) par un fichier venu d'un autre contexte, ce qui a cassé l'authentification.
  Leçon : montrer tout fichier existant à l'assistant avant de le remplacer, et ne jamais lui donner un contexte périmé.
- **Accents abîmés dans la base** : les textes saisis depuis PowerShell ou mongosh s'enregistrent avec le caractère de remplacement.
  Leçon : créer les données par le site ou l'API, jamais en ligne de commande.
- **Plusieurs comptes dans un même navigateur** : une seule session par site. Leçon : un navigateur ou une fenêtre privée par rôle.
- **Deux copies du site lancées** (ports 5173 et 5174) : fermer les anciennes fenêtres avant de relancer.

## 8. Vérification rapide au début d'une session

```powershell
cd "$HOME\pharmaloc-api"
git status
git log --oneline -5
npm run test:all
```

`git status` doit afficher « working tree clean » ; sinon, des changements n'ont pas été enregistrés. Compare le nombre de tests au dernier chiffre confirmé (section 2).
Même contrôle dans `pharmaloc-web` (`git status`, `git log`).

## 9. Modèle d'entrée à ajouter au journal à la fin d'une session

```
- **AAAA-MM-JJ** : ce qui a été fait ; résultat des tests (nombre) ; commits (API / site) ; ce qui reste à valider ; décision prise, s'il y en a une.
```
