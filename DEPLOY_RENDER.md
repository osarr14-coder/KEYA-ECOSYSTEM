# Déployer KEYA ECOSYSTEM sur Render

Premier déploiement de ce projet, nulle part avant ce document (voir
`packages/design-system/src/navigation/appOrigins.ts` : *"aucune
configuration de déploiement partagée dans ce repo"*, vrai jusqu'ici).

## Ce que ça déploie

- **1 base Postgres** (`keya-ecosystem-db`, plan payant `basic-256mb`) — RLS
  multi-tenant intact : le rôle fourni par Render n'est pas superuser
  (vérifié en reproduisant ce scénario en local), donc `FORCE ROW LEVEL
  SECURITY` s'applique réellement, aucun bricolage de rôle nécessaire
  contrairement au `docker-compose.yml` local. Plan payant (pas gratuit) :
  le compte Render utilisé a déjà une base gratuite active pour un AUTRE
  projet en production (KEYA/keyimmoafric.com, modèle économique distinct
  de KEYA ECOSYSTEM — à ne surtout pas toucher), et Render limite à une
  seule base gratuite par compte.
- **1 service web Python** (`keya-ecosystem-backend`) — API Django + admin.
- **4 sites statiques** (`keya-ecosystem-home`, `keya-ecosystem-build`, `keya-ecosystem-control`,
  `keya-ecosystem-web`) — les 4 apps frontend, chacune buildée depuis ce même repo.

Tout est décrit dans `render.yaml` à la racine — un "Blueprint" Render lit
ce fichier et crée les 6 services en un clic.

Noms préfixés `keya-ecosystem-` (pas juste `keya-`) : un déploiement réel a
révélé qu'un AUTRE projet actif existe déjà sur le même compte Render sous
le nom `keya-backend` (dépôt séparé, domaine personnalisé keyimmoafric.com,
plan payant) — sans ce préfixe, importer ce Blueprint aurait proposé
d'associer et d'écraser la configuration de ce service existant.

## Étapes

1. **Compte Render** — créez-en un sur https://render.com si besoin. La
   base Postgres (`keya-ecosystem-db`) est en plan payant `basic-256mb`
   (quelques dollars/mois, carte bancaire requise sur le compte) — voir
   ci-dessus pourquoi. Le reste (backend + 4 sites statiques) reste
   gratuit.
2. **New → Blueprint** dans le dashboard Render.
3. Connectez le dépôt GitHub `osarr14-coder/keya-ecosystem` (branche
   `master`).
4. Render détecte `render.yaml` et propose les 6 services décrits
   ci-dessus. Vérifiez les noms proposés (`keya-ecosystem-backend`, `keya-ecosystem-home`,
   `keya-ecosystem-build`, `keya-ecosystem-control`, `keya-ecosystem-web`, `keya-ecosystem-db`) — **s'ils sont déjà
   pris sur votre compte**, Render vous demandera de les renommer ; dans ce
   cas, éditez aussi les URLs qui les référencent dans `render.yaml`
   (`CORS_ALLOWED_ORIGINS`, les 4 `VITE_*_URL`, `ALLOWED_HOSTS`) avant de
   relancer le déploiement, elles ne se déduisent pas automatiquement des
   noms réels.
5. **`ADMIN_EMAIL`** — seule variable que Render vous demande de saisir à
   la main (le blueprint la déclare `sync: false`, volontairement laissée à
   votre choix). Un email valide suffit, aucune vérification d'envoi n'a
   lieu.
6. **Apply** — Render construit et déploie les 6 services (quelques
   minutes, les 4 sites statiques et le backend en parallèle).

## Se connecter une fois déployé

1. Ouvrez `https://keya-ecosystem-web.onrender.com` (ou le nom réel choisi à
   l'étape 4) — écran de connexion. **Pas** `keya-ecosystem-backend…` : c'est
   l'API (sa racine redirige vers l'application depuis le ticket B-055 ; avant,
   elle affichait « Not Found »).
2. Email : celui saisi à l'étape 5.
3. Mot de passe : généré automatiquement par Render (`ADMIN_PASSWORD`,
   `generateValue: true`, jamais choisi ni vu par personne d'autre que
   vous) — récupérable dans le dashboard Render, service `keya-ecosystem-backend` →
   onglet **Environment** → valeur de `ADMIN_PASSWORD`.
4. Vous arrivez sur le back-office (rôle `admin_keyimmo`, seul rôle amorcé
   — voir `apps/organizations/management/commands/seed_admin.py`) : une
   organisation de démonstration **« KEYIMMO AFRIC (démo) »** existe déjà,
   vous pouvez créer un Programme/Bien/Lot via l'onglet **Programmes**
   (ticket F-049).

## Limites connues (choix assumés pour ce premier déploiement)

- **Traitement média synchrone** (`CELERY_TASK_ALWAYS_EAGER=True`) —
  évite un service Redis + worker séparés (coût, complexité) pour un
  besoin aujourd'hui limité à la compression/miniature d'évidence (ticket
  004). Fonctionnellement transparent, juste plus lent qu'un vrai
  traitement en arrière-plan. Réversible : ajouter un service Redis +
  `CELERY_TASK_ALWAYS_EAGER=False` + un `Background Worker` Render lançant
  `celery -A config worker` le jour où le besoin se confirme.
- **Fichiers média éphémères** — Render ne persiste pas le disque d'un
  service web gratuit entre redéploiements ; les documents/preuves
  uploadés (ticket 004) disparaissent au prochain déploiement. Un stockage
  S3-compatible (`django-storages`) serait la solution durable — hors
  scope ici, pas un blocage pour explorer l'interface.
- **HSTS non activé** — délibérément, voir le commentaire dans
  `backend/config/settings.py` (irréversible côté navigateur une fois
  servi, risque jugé disproportionné pour un premier déploiement).
- **Plan gratuit Render** — les services web (backend + 4 statiques)
  s'endorment après 15 minutes d'inactivité ; la première requête après
  une veille prend ~30-60s pendant que `keya-ecosystem-backend` redémarre. Passer à
  un plan payant supprime cette latence.
- **Base Postgres payante dès le départ** (plus haut) — évite à la fois la
  limite « une seule base gratuite par compte Render » (déjà prise par
  l'autre projet) et l'expiration à 30 jours d'une base gratuite. Rien à
  surveiller côté échéance contrairement à une base restée gratuite.
- **Migrations dans `buildCommand`, pas `preDeployCommand`** —
  `preDeployCommand` (l'endroit normalement recommandé par Render pour les
  migrations, après le build, avant bascule du trafic) n'existe que sur
  les plans payants ; vérifié avant d'écrire `render.yaml`. Sur le plan
  free utilisé ici, `migrate`/`seed_admin` tournent donc dans
  `buildCommand` — fonctionnellement correct, seule différence réelle :
  une migration qui échouerait bloquerait le build lui-même plutôt qu'une
  étape post-build dédiée. `createcachetable` y tourne aussi (ticket
  B-047 : table du cache partagé des compteurs de throttle).
- **`NUM_PROXIES` à vérifier après le premier déploiement** (ticket B-047) —
  le throttle identifie l'appelant par l'adresse ajoutée par le dernier
  proxy de confiance dans `X-Forwarded-For` (défaut : 1 proxy). Journaliser
  l'en-tête d'une vraie requête : s'il contient plusieurs adresses ajoutées
  par l'infrastructure Render, ajuster la variable d'environnement
  `NUM_PROXIES` du service backend. Mal réglé, soit un attaquant
  contourne le throttle, soit tous les utilisateurs partagent un compteur.

## Comptes de démonstration (ticket B-053)

Pour dérouler le scénario du CDC V3 (§9) sans intervention en base :

1. Service `keya-ecosystem-backend` → **Environment** → renseigner `DEMO_PASSWORD`
   (au moins 10 caractères, choisi par vous — il n'est écrit nulle part dans le dépôt).
2. **Manual Deploy** → *Deploy latest commit* : le `buildCommand` lance
   `seed_demo_scenario`, qui crée (ou remet à jour) les comptes ci-dessous avec ce mot de
   passe, le programme « Résidence Démonstration Abidjan » (2 lots à 30 000 000 XOF) et le
   barème de paiement de démonstration. Relancé à chaque déploiement, il ne réinitialise
   jamais une démonstration en cours.
3. `https://keya-ecosystem-web.onrender.com` affiche la page d'accueil publique (programmes,
   garanties, chantiers suivis, simulateur — F-079) ; « Se connecter » ouvre
   `https://keya-ecosystem-web.onrender.com/connexion` : chaque compte est redirigé
   vers l'application de son rôle.

| Compte | Rôle | Application |
|---|---|---|
| `client1.demo@keya.test`, `client2.demo@keya.test` | client (acquéreur) | HOME |
| `adv.demo@keya.test` | gestionnaire ADV | apps/web |
| `admin.demo@keya.test` | admin KEYIMMO | apps/web |
| `finance.demo@keya.test` | Finance (démo) | apps/web (Dossiers clients, Virements déclarés, Comptes & décaissements) |
| `constructeur.demo@keya.test` | constructeur | BUILD |
| `inspecteur.demo@keya.test` | bureau de contrôle | CONTROL |

Parcours conseillé (CDC §9.1, circuit de paiement B-056) : `client1` réserve le Lot A1 dans HOME
(« Mon acquisition ») → `adv` voit « Réservation à valider » dans « À faire », clique « Ouvrir »
puis « Valider la réservation et appeler les frais » (fiche dossier), rédige, soumet et approuve
le contrat → `client1` voit sa prochaine action « Régler : Frais de réservation » avec les
instructions de virement (compte FICTIF) et clique « J'ai effectué le virement » → `finance`
confirme dans « Virements déclarés » (la réservation passe « Réservée », l'ADV et le client sont
notifiés) → `adv` émet le complément (2 900 000) → `client1` le déclare, `finance` le confirme,
`client1` signe le contrat (« Concrétisée »)
→ `constructeur` déclare « Fondations » et joint une pièce (BUILD, onglet Jalons) → `admin`
missionne le contrôleur (apps/web, Contrôles à affecter) → `inspecteur` rend son avis (CONTROL) ;
avec réserve : le constructeur propose une correction, l'admin missionne le recontrôle, avis
conforme → `finance` prépare 1 000 000 sur le jalon, contrôle l'éligibilité, exécute (Comptes &
décaissements) → `constructeur` confirme la réception (BUILD, Paiements reçus) → `finance`
rapproche. Disponible final : 2 000 000 XOF.

Données intégralement fictives. Pour retirer l'accès : vider `DEMO_PASSWORD` ne supprime
pas les comptes ; changer sa valeur puis redéployer change leur mot de passe.

## Redéployer après un nouveau commit

Render redéploie automatiquement à chaque push sur `master` (comportement
par défaut d'un Blueprint) — rien à faire. `seed_admin` (dans
`buildCommand`) est idempotent, relancé à chaque déploiement sans risque
(voir sa docstring).
