# Mettre PharmaLoc en ligne

Ce guide ne dépend d'aucun hébergeur : il décrit ce que l'API, le site et la base doivent avoir, et dans quel ordre.
Les offres, prix et régions des hébergeurs changent : vérifie-les sur leur site avant de choisir.

## 0. Avant de commencer : ce qui bloque encore

- **Le paiement réel n'existe pas.** En production, le prestataire simulé est désactivé : un patient peut chercher et commander,
  mais au moment de payer il reçoit l'erreur `PAYMENT_PROVIDER_NOT_CONFIGURED` (501). Une version en ligne sans prestataire
  sert à montrer l'application, pas à vendre.
- **Aspects juridiques** : PharmaLoc traite des données personnelles et de santé, et la vente de médicaments est réglementée.
  Fais vérifier par un juriste ce que la loi sénégalaise sur les données personnelles (déclaration auprès de la Commission de
  protection des données personnelles) et la réglementation pharmaceutique exigent : conditions d'utilisation, politique de
  confidentialité, responsabilité des pharmacies. Ce guide n'est pas un avis juridique.

## 1. L'architecture à viser

```
Navigateur ──► Site (fichiers statiques)  ──/api/*──►  API Node.js  ──►  MongoDB géré (avec mot de passe)
               https://app.exemple.sn                  (serveur permanent)
```

Choix recommandé : **le site relaie `/api/*` vers l'API** (règle de réécriture de l'hébergeur du site, ou reverse proxy).
Pour le navigateur, tout reste sur une seule origine : le cookie de session fonctionne tel quel et le code du site n'a pas à changer.

L'autre choix, un site et une API sur deux adresses différentes, exige de modifier le site (appeler l'adresse de l'API
avec `credentials: "include"`) et de garder les deux sous le même domaine parent (`app.exemple.sn` et `api.exemple.sn`),
sinon le cookie `SameSite=Lax` n'est pas envoyé. Ne le choisis que si l'hébergeur du site ne sait pas relayer `/api`.

## 2. La base de données

1. Utilise un service MongoDB **géré** (ou un serveur MongoDB que tu administres sérieusement). Ne mets jamais en ligne le `mongod` de ton PC.
2. Choisis une région proche de tes utilisateurs et de l'API : vérifie ce que l'hébergeur propose près de l'Afrique de l'Ouest,
   et garde l'API et la base dans la même région pour limiter la latence.
3. Crée un utilisateur de base de données qui n'a que le droit `readWrite` sur la base `pharmaloc`, avec un mot de passe long et unique.
4. Restreins les connexions : liste d'adresses autorisées (celles de l'API), pas « tout Internet » si l'hébergeur le permet.
5. Active les **sauvegardes automatiques** et note comment restaurer. Fais un essai de restauration avant d'ouvrir au public.
6. Récupère l'adresse de connexion : `mongodb://utilisateur:motdepasse@hote/pharmaloc?...` (ou `mongodb+srv://...`).
   Les caractères spéciaux du mot de passe doivent être encodés pour une URL. Ne la colle **jamais** dans une conversation ni dans Git.

## 3. L'API

Prérequis : Node.js 20 ou plus (le projet l'exige), un serveur qui tourne en permanence et redémarre en cas d'arrêt.

| Réglage | Valeur |
| --- | --- |
| Commande de démarrage | `npm start` |
| Installation | `npm ci` (ou `npm install`) |
| Vérification de santé | `GET /api/health` (répond 503 si la base est injoignable) |

Variables d'environnement, à saisir dans le tableau de bord de l'hébergeur (jamais dans Git) :

| Variable | Valeur |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | l'adresse de connexion, **avec identifiants** (le serveur refuse de démarrer sans) |
| `ALLOWED_ORIGINS` | l'adresse du site, en `https`, sans `/` final : `https://app.exemple.sn` |
| `TRUST_PROXY` | le nombre de proxys devant l'API, en général `1` |
| `PORT` | souvent fourni par l'hébergeur ; sinon 3000 |

`ALLOWED_ORIGINS` est nécessaire **même avec le relais `/api`** : le contrôle anti-CSRF compare l'origine du site à l'adresse que voit l'API.
Ne définis pas `RATE_LIMIT=off` : le serveur refuse de démarrer.

Au démarrage en production, l'API vérifie sa configuration. Si elle affiche `Configuration refusée : ...`, corrige la ligne indiquée.

HTTPS : il se fait devant l'API (l'hébergeur ou un reverse proxy), jamais dans l'API elle-même.
La limitation de débit est en mémoire : elle suppose **une seule instance** de l'API. Avec plusieurs instances, il faudra un stockage partagé.

### Créer le premier administrateur

Une fois la base prête, depuis ton PC (la variable n'existe que dans cette fenêtre, elle n'est écrite nulle part) :

```powershell
cd "C:\Users\BEN BIRAMA\pharmaloc-api"
$env:MONGODB_URI = Read-Host "Adresse de connexion de production"
$env:ADMIN_NAME = "Administrateur"
$env:ADMIN_EMAIL = "admin@exemple.sn"
$env:ADMIN_PASSWORD = Read-Host "Mot de passe (long et unique)"
npm run create-admin
```

Ferme ensuite la fenêtre PowerShell. L'adresse de la base de production doit autoriser ton adresse IP le temps de cette opération,
puis tu retires l'autorisation. Le premier administrateur crée ensuite tous les autres comptes depuis le site.

## 4. Le site

1. `npm run build` dans `pharmaloc-web` produit le dossier `dist/`, à déposer sur un hébergement de fichiers statiques.
2. Règles à configurer chez l'hébergeur (leur syntaxe dépend de chaque service) :
   - `/api/*` doit être relayé vers l'adresse de l'API, **sans changer le chemin** ;
   - toute autre adresse doit renvoyer `index.html` (le site utilise les adresses `/rechercher`, `/commande/...`, qui n'existent pas comme fichiers).
3. Vérifie dans le navigateur (`F12`, onglet Réseau) que les appels partent bien vers `/api/...` du même site, et que le cookie `pl_session` apparaît après connexion.

## 5. Nom de domaine et HTTPS

Un nom de domaine, des certificats HTTPS valides (gérés par l'hébergeur dans la plupart des cas) et la redirection de `http` vers `https`.
Sans HTTPS, les cookies sécurisés ne sont pas envoyés et la connexion échoue : c'est voulu.

## 6. Essai de bon fonctionnement après la mise en ligne

1. `https://app.exemple.sn/api/health` répond `status: OK` et `database: connected`.
2. Créer un compte patient, se déconnecter, se reconnecter.
3. Se connecter en administrateur : créer une pharmacie et un responsable (mot de passe provisoire), vérifier qu'il doit le changer à la première connexion.
4. Le responsable ajoute un médicament, une réception de stock et un prix ; l'administrateur publie le médicament.
5. Le patient cherche, voit la pharmacie, commande ; la commande arrive dans l'espace de la pharmacie ; le paiement répond 501 tant qu'aucun prestataire n'est branché.
6. Essayer de forcer une page d'un autre rôle : tu dois être renvoyé vers ton espace.

## 7. Exploitation

- **Surveillance** : une alerte sur `/api/health` (si l'hébergeur propose un contrôle de disponibilité) et la lecture régulière des journaux de l'API.
- **Sauvegardes** : vérifie qu'elles s'exécutent vraiment, et refais un essai de restauration de temps en temps.
- **Mises à jour** : `npm run test:all` avant chaque déploiement ; `npm audit` de temps en temps pour les dépendances ; garde les modifications de base compatibles avec la version précédente pour pouvoir revenir en arrière.
- **Retour arrière** : redéployer le commit précédent du dépôt.
- **Secrets** : changer le mot de passe de la base si l'adresse de connexion a été exposée ; ne jamais les mettre dans Git ni dans un message.
- **Un environnement d'essai** (une copie de l'API et du site avec une base à part) évite de tester sur les vraies données.

## 8. Ce qu'il faut décider avant de choisir un hébergeur

- Ton budget mensuel, et le nombre d'utilisateurs visé au lancement.
- Où se trouvent tes utilisateurs : la latence vers le serveur et la base compte pour une application mobile.
- Qui s'occupe du serveur : un service géré coûte plus cher, mais évite d'administrer toi-même un serveur, ses mises à jour et sa sécurité.
- Le moyen de paiement : ses exigences (adresse HTTPS publique pour le webhook, déclaration de l'activité) peuvent influencer l'hébergement.
