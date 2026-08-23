# Déployer KEYA ECOSYSTEM sur Render

Premier déploiement de ce projet, nulle part avant ce document (voir
`packages/design-system/src/navigation/appOrigins.ts` : *"aucune
configuration de déploiement partagée dans ce repo"*, vrai jusqu'ici).

## Ce que ça déploie

- **1 base Postgres** (`keya-ecosystem-db`) — RLS multi-tenant intact : le rôle fourni
  par Render n'est pas superuser (vérifié en reproduisant ce scénario en
  local), donc `FORCE ROW LEVEL SECURITY` s'applique réellement, aucun
  bricolage de rôle nécessaire contrairement au `docker-compose.yml` local.
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

1. **Compte Render** — créez-en un sur https://render.com si besoin (aucun
   engagement de paiement requis pour le plan gratuit utilisé ici).
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
   l'étape 4) — écran de connexion.
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
- **Base Postgres gratuite limitée dans le temps** — Render supprime une
  base gratuite **30 jours** après sa création (14 jours de grâce pour la
  passer en payant avant suppression définitive des données). Pour un
  usage au-delà d'un mois, passer `keya-ecosystem-db` en plan payant AVANT
  l'échéance (dashboard Render → base → Upgrade) — vérifié à la rédaction
  de ce document, sujet à changer côté Render. **Une seule base gratuite
  active par compte Render** — si vous en avez déjà une ailleurs sur ce
  compte, l'import du blueprint vous proposera de passer `keya-ecosystem-db`
  directement en payant.
- **Migrations dans `buildCommand`, pas `preDeployCommand`** —
  `preDeployCommand` (l'endroit normalement recommandé par Render pour les
  migrations, après le build, avant bascule du trafic) n'existe que sur
  les plans payants ; vérifié avant d'écrire `render.yaml`. Sur le plan
  free utilisé ici, `migrate`/`seed_admin` tournent donc dans
  `buildCommand` — fonctionnellement correct, seule différence réelle :
  une migration qui échouerait bloquerait le build lui-même plutôt qu'une
  étape post-build dédiée.

## Redéployer après un nouveau commit

Render redéploie automatiquement à chaque push sur `master` (comportement
par défaut d'un Blueprint) — rien à faire. `seed_admin` (dans
`buildCommand`) est idempotent, relancé à chaque déploiement sans risque
(voir sa docstring).
