# KEYA ECOSYSTEM

Projet neuf, distinct de `C:\Projets claude\KEYA` (CRM keyimmoafric.com) et de
`C:\Projets claude\UTB` (ERP UTB). Ne jamais lire ni écrire dans ces deux dossiers
depuis ce projet — aucun code, aucune donnée, aucune dépendance partagée. Un `git init`
dédié vit à la racine de ce dossier.

## Doctrine produit — Visible Trust

Le cœur du produit est la confiance vérifiable sur un chantier, pas un simple suivi de
statut :

- **Rien n'est codé en dur ce qui doit varier par pays.** `CountryPack` porte toute
  configuration variable (jalons, règles). Le MVP n'a qu'un pack Sénégal, mais c'est
  toujours une ligne de données, jamais un enum ou une constante applicative.
- **Le statut d'un objet métier n'est jamais stocké comme vérité indépendante.** Il se
  dérive du dernier `TrustEvent` (append-only, voir ticket 003). Pas de colonne `status`
  mise à jour en place sur les objets métier une fois ce ticket en place.
- **Chaque requête est scopée par organisation via RLS PostgreSQL**, pas seulement par
  filtre applicatif (voir ticket 001). Toute nouvelle table portant `organization_id`
  doit avoir sa policy RLS et son test de contournement au niveau DB.

## Règles non négociables

Règles transversales qui s'appliquent à tout ticket, présent ou futur — pas seulement au
ticket qui les a introduites.

- **Invariant 25.6 (complément V4.0) : aucune Task ne doit attribuer implicitement une
  décision à KEYIMMO.** Une `Task` liée à une décision qui n'appartient pas à KEYIMMO (ex :
  une décision bancaire, notariale, ou d'une autre autorité) doit toujours nommer dans son
  libellé l'acteur RÉELLEMENT responsable — jamais suggérer que KEYIMMO tranche à sa place.
  Introduit au ticket 006 (Task Inbox), voir la section dédiée ci-dessous. Tout nouveau
  générateur de libellé de Task, dans n'importe quel ticket futur, doit être ajouté au
  registre `LABEL_GENERATORS` (`apps/tasks/services.py`) pour rester couvert par le test de
  garde `TestNoTaskLabelGeneratorAttributesDecisionToKeyimmo`
  (`apps/tasks/tests.py`) — ce test scanne le code source de chaque générateur enregistré,
  pas seulement le texte produit par ceux qui existent déjà.

## Stack

- **Backend** : Django 4.2 + Django REST Framework, conventions alignées sur
  `C:\Projets claude\KEYA\backend` (mêmes versions de dépendances) mais **aucun fichier
  copié** — projet réinitialisé de zéro.
- **Auth** : email + mot de passe, JWT via `djangorestframework-simplejwt` pour le MVP.
  Le ticket 001 prévoit un provider managé à terme (ADR à rédiger le jour où ça devient
  pertinent) — ne pas sur-ingénierer avant.
- **DB** : PostgreSQL (RLS obligatoire — jamais SQLite, y compris en test, dès qu'une
  policy RLS est en jeu : `settings_test.py` doit pointer sur Postgres).
- **Tests** : pytest + pytest-django + factory-boy.
- **Conteneurs** : `docker-compose.yml` dédié, port Postgres `5433` (host) pour ne pas
  entrer en collision avec KEYA/UTB qui utilisent `5432`. Nom de projet Docker
  `keya_ecosystem` explicite dans les noms de service/volume.

## Structure

```
backend/
  apps/
    accounts/        # User custom (email comme identifiant), auth JWT
    organizations/   # Organization, CountryPack, Membership, Role
    programs/         # Program, Asset, Lot, MilestoneTemplate(+Step), Milestone
    trust/            # TrustEvent append-only + repository (create/lecture seule)
    evidence/         # Document (GED), WorkDeclaration, Evidence
    inspections/      # Inspection, Reserve (machine à état), ReserveCorrection
    tasks/            # Task (inbox transversale, app label 'inbox_tasks')
    home/             # agrégation lecture seule pour HOME client, aucun modèle propre (ticket 008)
    build/            # agrégation Exceptions/Tous les lots pour BUILD, aucun modèle propre (ticket 009)
    core/             # middleware RLS, viewsets/mixins réutilisables, utilitaires partagés
  config/             # settings.py, settings_test.py, urls.py, wsgi/asgi
  conftest.py         # fixtures de test partagées entre apps (ex : real_celery_worker)
  pytest.ini          # norecursedirs explicite — ne JAMAIS retirer, voir section BUILD (ticket 009)
packages/             # monorepo npm (workspaces), frontend — indépendant du backend Django
  design-system/       # AppShell, StatusBadge, AlertBanner, tokens (densité, couleurs) (tickets 007-008)
apps/                  # apps web du monorepo npm (ticket 008+), une par surface produit
  home/                 # app HOME (client), package @keya/home (ticket 008)
  build/                 # app BUILD (constructeur/sponsor), package @keya/build (ticket 009)
  control-pwa/           # PWA CONTROL (inspecteur), package @keya/control-pwa (ticket 010, passe 1)
package.json           # racine du monorepo npm — workspaces: ["packages/*", "apps/*"]
```

Un nouveau domaine métier (trust events, travaux/preuves, inspections...) = une
nouvelle app Django sous `apps/`, jamais un fourre-tout dans `core`. `apps/core` ne
contient que ce qui est réellement transverse (middleware RLS, `OrganizationScopedMixin`
dans `viewsets.py`) — pas de logique propre à un domaine métier.

Pattern des ViewSets CRUD scopés par organisation (voir `apps/programs/views.py`) :
hériter de `apps.core.viewsets.OrganizationScopedMixin`, qui filtre le queryset par
`request.organization` et pose `organization` automatiquement à la création — la RLS
reste le rempart de dernier recours, ce mixin est un filtre applicatif en plus, pas à sa
place. Toute table enfant qui dénormalise `organization_id` depuis son parent (ex :
`Asset.organization` recopié depuis `Asset.program.organization`) doit aussi scoper le
queryset du champ FK parent dans le serializer (`self.fields['program'].queryset = ...`)
pour qu'un client ne puisse pas rattacher sa ligne à un parent d'une autre organisation
en forgeant son id.

Logique métier qui dépasse un simple CRUD (ex : instanciation des `Milestone` d'un `Lot`
à partir du `MilestoneTemplate` actif) vit dans un `services.py` par app, pas dans les
vues ni les serializers.

## RLS multi-tenant — mécanique

1. Le middleware (`apps/core/middleware.py`) résout l'organisation active depuis le JWT
   authentifié + `Membership`, puis exécute
   `SET LOCAL app.current_organization_id = '<uuid>'` sur la connexion Postgres de la
   requête en cours.
2. Chaque table métier scopée par organisation porte une colonne `organization_id` et une
   policy RLS du type
   `USING (organization_id = current_setting('app.current_organization_id')::uuid)`.
3. RLS est activé avec `FORCE ROW LEVEL SECURITY` pour qu'elle s'applique aussi au
   propriétaire de la table (le rôle applicatif Django ne doit jamais être superuser en
   test d'intégration RLS, sinon la policy est silencieusement ignorée).
4. Tout test de non-contournement RLS doit exécuter du SQL brut (hors ORM Django) pour
   prouver que la policy bloque même en contournant la couche applicative — un test qui
   ne passe que par l'API Django prouve la vue, pas la policy. **Piège vécu au ticket
   001** : une connexion psycopg2 vraiment séparée ne voit pas les lignes créées par une
   fixture de test qui utilise le fixture pytest-django `db` (transaction ouverte puis
   rollback, jamais committée — invisible depuis une autre session). Deux options
   valables selon le cas : soit exécuter le SQL brut sur `django.db.connection.cursor()`
   (même session que l'ORM, donc voit les données non committées) en fixant le contexte
   RLS explicitement à chaque test avec `apps.core.rls.set_rls_context(...)`, soit passer
   la fixture sur `transactional_db` pour de vrais commits si une connexion séparée est
   réellement nécessaire. Voir `apps/organizations/tests.py` pour l'implémentation de
   référence.

## Append-only (TrustEvent, ticket 003)

`trust_event` ne doit jamais recevoir d'UPDATE ni de DELETE, pour personne, pas même un
rôle admin applicatif. Trois couches indépendantes, pas une seule — contourner l'une ne
contourne pas les autres :

1. **Python — `TrustEvent.save()`/`delete()` surchargés + `TrustEventQuerySet`**
   (`apps/trust/models.py`) lèvent `TrustEventIsImmutable` immédiatement, avant toute
   requête DB, dès qu'on tente `instance.save()` sur une ligne existante, `instance.delete()`,
   ou `TrustEvent.objects.filter(...).update()/.delete()`. C'est la couche qui protège contre
   un contournement de `apps/trust/repository.py` **resté en Django** — sans elle, ces
   contournements échoueraient silencieusement (voir couche 2), un piège pour un futur
   développeur qui ne passerait pas par le repository.
2. **Aucune policy RLS UPDATE/DELETE n'est définie** sur la table — PostgreSQL applique
   alors un déni par défaut pour ces commandes (aucune ligne visible/ciblable), même pour
   le propriétaire de la table via `FORCE ROW LEVEL SECURITY`. Une tentative d'UPDATE/
   DELETE **en SQL brut** (donc hors de la couche 1, qui ne protège que ce qui passe par
   l'ORM Django) affecte silencieusement 0 ligne, sans lever d'exception : un test doit
   donc vérifier l'invariant (`cursor.rowcount == 0` + donnée inchangée après
   `refresh_from_db()`), pas s'attendre à une erreur.
3. **Un trigger `BEFORE UPDATE/DELETE`** (migration `0002_append_only`) lève une exception
   inconditionnellement au niveau DB. Il est actuellement « silencieux » en usage normal (la
   couche 2 bloque avant qu'il n'ait à s'exécuter), mais c'est le filet de sécurité qui
   continuerait à bloquer si une policy RLS UPDATE/DELETE était ajoutée par erreur dans une
   migration future — d'où un test dédié qui garde son existence via `pg_trigger`
   (`apps/trust/tests.py::TestAppendOnly::test_append_only_trigger_exists_in_the_database`).

Toute correction d'un événement est un nouvel appel à `repository.create(..., previous_event=...)`,
jamais une modification. Le module `apps/trust/repository.py` n'expose et ne doit jamais
exposer de fonction `update`/`delete` — c'est vérifié par un test (`hasattr`).

Les FK de `TrustEvent` (`organization`, `actor`, `subject_type`, `previous_event`) sont
toutes en `on_delete=PROTECT`, jamais `CASCADE` : un TrustEvent ne doit jamais disparaître
comme effet de bord de la suppression d'une autre ligne — cohérent avec le principe
append-only lui-même (une purge, si un jour nécessaire, doit être un choix explicite et
tracé).

## GED / Document (ticket 004)

Aucun fichier de `Document` n'est jamais servi par une route non signée. `config/urls.py`
ne monte volontairement jamais `static(MEDIA_URL, document_root=MEDIA_ROOT)` : il n'existe
donc littéralement aucune route qui pourrait servir un fichier brut, même par erreur.
L'unique chemin d'accès :

1. `GET /api/documents/{id}/signed-url/` (authentifié, scopé organisation) — renvoie un
   lien contenant un token signé (`django.core.signing.TimestampSigner`, 5 min) via
   `apps/evidence/access.py`.
2. `GET /api/documents/download/<token>/` — revérifie signature + expiration, PUIS
   revérifie la permission indépendamment (organisation active + `sensitivity_level`,
   voir ci-dessous) : un token valide ne suffit jamais seul, l'appartenance a pu changer
   entre l'émission du lien et son utilisation.

`sensitivity_level` conditionne réellement l'accès, pas seulement l'affichage : un
document `confidentiel` n'est accessible qu'à son propriétaire (`owner`) ou à un membre
avec le rôle `admin_keyimmo` — tout autre membre de la même organisation, qui aurait accès
à un document `interne`/`public` identique, en est exclu (`access.user_can_access_document`,
appelé à la fois à l'émission du lien ET au téléchargement). Toute nouvelle règle d'accès
basée sur `sensitivity_level` doit passer par cette fonction, pas par une vérification
ad hoc dans une vue.

Stockage : `FileSystemStorage` local pour le MVP, pas de vrai S3/MinIO branché (Docker
indisponible dans cet environnement, voir ticket 001). Le champ `hash` d'un `Document` est
celui du fichier **tel qu'uploadé**, jamais recalculé après compression — c'est l'ancrage
de chaîne de custody. Le traitement asynchrone (compression + miniature,
`apps/evidence/tasks.py`) ne doit jamais toucher aux champs de provenance
(`source`, `captured_at`, `owner`, `created_at`, `hash`).

Celery (`config/celery.py`) tourne contre un vrai broker Redis
(`docker run -d --name keyimmo-redis -p 6379:6379 redis:7-alpine`), `CELERY_TASK_ALWAYS_EAGER=False`
par défaut. `config/settings_test.py` repasse ce flag à `True` pour la majorité des tests
(rapides, exécution synchrone dans la transaction du test — lu directement depuis
`os.environ`, jamais depuis `.env`, qui contient `False` pour l'environnement réel) ; seuls
les tests d'intégration dédiés (`apps/evidence/test_celery_integration.py`) le désactivent
pour faire tourner un vrai worker (sous-processus `--pool=solo`, requis sous Windows). Une
tâche Celery n'a par construction aucune requête HTTP pour poser le contexte RLS
(organisation active) : `organization_id`/`requested_by_user_id` sont donc des arguments
explicites de la tâche, posés en tout début d'exécution via `apps.core.rls.set_rls_context`
à l'intérieur d'un `transaction.atomic()` englobant tout son corps — sans ce bloc, le
contexte retombe avant la requête suivante (`SET LOCAL` n'a d'effet que pour la transaction
en cours, un worker tourne en autocommit par défaut). Voir
**[ADR 0001](docs/adr/0001-celery-eager-mode.md)** pour l'historique complet et les bugs
réels rencontrés en branchant un vrai worker.

## Inspections / Reserve — accès cross-organisation (ticket 005)

Premier endroit du projet où deux organisations différentes doivent légitimement
interagir sur la même donnée : la règle d'indépendance du contrôle (V3.0 §2.3) impose
qu'un inspecteur ne soit **jamais** membre de l'organisation du lot qu'il inspecte. Le
modèle RLS de tout le reste du projet (une ligne = une organisation, l'acteur agit
toujours dans sa propre organisation active) ne permet donc pas à l'inspecteur d'écrire
normalement dans `Inspection`/`Reserve` — ces tables appartiennent à l'organisation du
**lot** (le constructeur), jamais à celle de l'inspecteur, précisément pour que le
constructeur puisse ensuite les lire/y référencer une réserve normalement.

`apps/inspections/services.create_inspection` résout ça en réappliquant, de façon étroite
et documentée, le même schéma que le bootstrap de `RegisterSerializer.create` (ticket
001) : bascule explicite du contexte RLS vers l'organisation cible
(`set_rls_context(organization_id=...)`) le temps de l'opération, toujours restaurée vers
l'organisation de l'inspecteur ensuite (bloc `finally`, y compris en cas d'erreur). Ce
n'est PAS un bypass général de RLS — seul ce service y a recours, pour cette seule raison.

Conséquence assumée, hors scope de ce ticket : `target_organization_id` est fourni
explicitement par le client dans le payload de création (`POST /api/inspections/`), faute
de mécanisme d'affectation/dispatch (ticket 006 Task Inbox). Et l'inspecteur ne peut pas
relister ses inspections passées via l'API : `InspectionViewSet` reste scopé normalement
sur `request.organization`, donc sur la sienne — les lignes qu'il a créées vivent dans
l'organisation cible. Une vraie « historique de mes inspections » cross-organisation
nécessiterait une requête dédiée, pas encore construite.

`Reserve` n'a pas de champ `status` : il se dérive du dernier `TrustEvent` de ce sujet
(`apps.inspections.services.get_reserve_status`, valeurs portées par `source` :
`ouverte`/`correction_proposee`/`nouvelle_inspection`/`levee`/`rejetee` — pas par `level`,
qui reste un des 5 niveaux fixes de la doctrine Visible Trust). Aucun endpoint ne permet
de fixer ce statut directement : `ReserveViewSet` est strictement en lecture seule (pas de
`create`/`update`/`destroy`), et la seule route qui fait progresser la machine à état
(`InspectionViewSet.create`) est réservée au rôle `inspecteur` (`IsInspecteur`) — un
constructeur y est refusé explicitement (403), jamais silencieusement absent d'un menu.

## Task Inbox (ticket 006)

`Task` est polymorphe exactement comme `TrustEvent` (`subject_type`/`subject_id` via
`django.contrib.contenttypes`) — un `type` (task/notification/alert/exception) est
TOUJOURS renseigné et exposé par l'API, c'est ce qui rend les 4 types « structurellement
distincts » plutôt qu'une liste non typée qui se ressemblerait.

**Exception assumée et documentée à la doctrine « le statut ne se stocke jamais »** :
`Task.status` est un champ réellement stocké (voir docstring du modèle). La doctrine
(CLAUDE.md, section Visible Trust) concerne les objets dont le statut est une AFFIRMATION
DE CONFIANCE avec provenance (Milestone, WorkDeclaration, Evidence, Reserve) — une `Task`
n'affirme aucune confiance sur son sujet, c'est un objet opérationnel d'inbox dont le
statut est un fait sur elle-même. Marquer une Task traitée (`TaskViewSet.complete` →
`apps.tasks.services.complete_task`) ne touche donc jamais au `TrustEvent`/`Reserve` qui
l'a déclenchée : les deux sont des tables sans lien de suppression en cascade entre elles
(référence polymorphe, pas de FK réelle).

`apps.tasks.tasks.process_reserve_opened` réutilise **exactement** le pattern de
`apps.evidence.tasks.process_document_media` (ticket 004) : `organization_id`/
`actor_user_id` en arguments explicites, posés via `set_rls_context` à l'intérieur d'un
`transaction.atomic()` englobant tout le corps de la tâche. Déclenchée depuis
`apps.inspections.services._open_new_reserve` via un vrai `.delay()` — jamais un appel
synchrone déguisé en asynchrone (testé par mock de `.delay()` ET par un test contre un
vrai worker, `apps/tasks/test_celery_integration.py`).

Le constructeur assigné à une `Task` générée par une réserve ouverte n'est stocké nulle
part explicitement (`Lot` n'a pas de champ « assigné », ticket 002) — il se déduit de
`WorkDeclaration.declared_by`, via l'inspection à l'origine de la réserve
(`apps.tasks.services.resolve_constructeur_for_reserve`). Le libellé généré
(`apps.tasks.services._reserve_opened_label`) nomme explicitement le constructeur comme
responsable — jamais KEYIMMO : critère d'acceptation vérifié par une lecture du texte
réellement généré, pas seulement une revue du code
(`apps/tasks/tests.py::TestGeneratedLabelNeverAttributesDecisionToKeyimmo`). Toute
nouvelle Task générée automatiquement par ce projet doit suivre la même règle.

`GET /api/me/tasks/` est scopé sur `assignee=request.user`, pas sur l'organisation active
comme le reste du projet — RLS reste un filet de sécurité en plus (l'organisation active
doit de toute façon correspondre à celle de l'assigné), jamais à la place de ce filtre.

`backend/conftest.py` centralise désormais la fixture `real_celery_worker` (introduite au
ticket 004) et les helpers de seed anti-TRUNCATE (`get_or_create_senegal_country_pack`,
`ensure_senegal_milestone_template_seeded`) — partagés entre apps plutôt que dupliqués par
fichier de test. **Piège rencontré en écrivant les tests du ticket 006** : un test
`transactional_db` antérieur dans la même session pytest (TRUNCATE entre tests) peut aussi
effacer le `MilestoneTemplate` Sénégal (ticket 002), pas seulement le `CountryPack` — tout
test `transactional_db` qui a besoin de `Milestone` doit appeler
`ensure_senegal_milestone_template_seeded()`, pas seulement
`get_or_create_senegal_country_pack()`.

## Design system frontend (ticket 007)

Premier code frontend du projet — monorepo npm workspaces à la racine (`package.json`
racine, `workspaces: ["packages/*"]`), **distinct du backend Django** (`/backend` reste un
projet Python autonome, aucune dépendance croisée). `packages/design-system` est le
premier package ; les futures apps web des tickets 008+ (HOME, BUILD, FINANCE) vivront
dans ce même monorepo, probablement sous un futur `apps/` (choix à confirmer quand ces
tickets démarreront), et consommeront ce package via le protocole workspace plutôt que par
copie de fichiers.

Stack : React 18 + TypeScript, Vitest + Testing Library (pas de bundler de build pour le
MVP — le package s'importe directement depuis `src/` via les workspaces, `tsc --noEmit`
sert de vérification de types, pas de compilation). Tests dans `*.test.ts(x)` à côté du
code qu'ils testent, comme le reste du projet (pytest) plutôt qu'un dossier `__tests__/`
séparé.

**`AppShell`** (`src/components/AppShell`) est un seul composant paramétré par une prop
`density: 'dense' | 'confortable'` — jamais deux implémentations séparées pour BUILD/
FINANCE (dense) et HOME (confortable). Le filtrage des modules professionnels (BUILD,
FINANCE, NOTARY) est générique : chaque `AppModule` porte un `requiredRoles?: string[]`
optionnel, un module sans cette prop est toujours visible, un module qui la porte n'est
visible que si `userRoles` contient au moins un des rôles listés — ce package ne connaît
pas le vocabulaire RBAC exact du backend (ticket 001), c'est à l'app consommatrice de
fournir les bons codes de rôle à `userRoles`.

**`StatusBadge`** (`src/components/StatusBadge`) associe à chacun des 5 niveaux
`TrustLevel` (mêmes valeurs que `apps/trust/models.py::TrustLevel`, ticket 003 — même
vocabulaire de doctrine, aucune dépendance de code vers `/backend`) une **forme SVG
géométriquement distincte** (`shapes.tsx`), pas seulement une couleur différente — c'est ce
qui rend le badge distinguable en niveaux de gris (testé en comparant les `d` de path
réellement rendus, pas juste une étiquette `data-shape`). Le popover au clic attend des
données au format du retour de `apps/trust/repository.py::get_current_status` (`level`,
`source`, `actor`, `scope`, `createdAt`) — le composant ne calcule ni score ni pourcentage,
il affiche l'événement tel quel, cohérent avec la doctrine Visible Trust.

**Gouvernance "une seule source de vérité visuelle" (critère d'acceptation)** : un test
(`src/governance.test.ts`) scanne le CODE SOURCE (pas les noms de dossier) à la recherche
de tout composant exporté dont le nom évoque un badge, sur deux périmètres : 1)
`packages/design-system/src` lui-même (un seul résultat attendu, `StatusBadge`) ; 2) `/apps`
à la racine du monorepo, où vivront les futures apps HOME/BUILD (tickets 008+) — **tant que
ce dossier n'existe pas, il n'y a rien à scanner, mais le jour où un ticket futur le crée,
ce même test (sans modification) commence réellement à le couvrir**, vérifié par un test
manuel (fixture temporaire avec un composant `TrustBadgeV2` dans un fichier au nom neutre,
supprimée après vérification que le test échouait bien dessus). Ne pas neutraliser ni
supprimer la partie `/apps` de ce test en la croyant inutile avant que ce dossier existe —
c'est précisément le mécanisme qui évite qu'un badge concurrent ne se glisse dans un écran
BUILD ou HOME sans revue manuelle. Un nom de composant `*Badge*` légitimement différent
(ex : un badge numérique de compteur, pas un badge de niveau de confiance) s'ajoute à
`ALLOWLISTED_BADGE_COMPONENT_NAMES` dans le test, jamais en affaiblissant la regex.

**Tokens de densité** (`src/tokens/density.ts`) : `densityTokens.dense`/`densityTokens.confortable`
sont exportés indépendamment d'`AppShell` précisément pour être réutilisés par un futur
composant de liste/tableau (ticket 009, Control Tower BUILD) sans dupliquer les valeurs.

**`AlertBanner`** (`src/components/AlertBanner`, ajouté au ticket 008) : bandeau d'alerte
générique (couleur + icône via `tokens/colors.ts::semanticColors.alert`), volontairement
distinct de `StatusBadge` — une alerte opérationnelle n'est pas un `TrustLevel`. Voir
section HOME client (ticket 008) ci-dessous pour le contexte de son introduction.

## HOME client (ticket 008)

Premier app frontend du monorepo — `apps/home` (package `@keya/home`), à côté de
`packages/design-system` (ticket 007). Décision prise à ce ticket, faute de précédent :
les futures apps web (BUILD, FINANCE...) vivront sous `apps/<nom>`, workspace npm React +
Vite + Vitest, consommant `@keya/design-system` via le protocole workspace — jamais de
copie de fichiers. `AppShell` (variante `confortable`) et `StatusBadge` sont réutilisés
tels quels (import direct), rien n'est redéfini en parallèle.

**Deux ajouts au schéma `apps/programs`, nécessaires à ce ticket** (Asset/Lot étaient
« finis » au ticket 002, mais n'avaient pas besoin de ces données avant) :
- `Asset.location` (texte libre) : absent du ticket 002, requis par le hero du bien.
- `LotClient` (`organization`/`lot`/`client`, RLS standard) : rattache un utilisateur
  (rôle `client`) au(x) `Lot` qu'il a acquis. C'est la donnée qui fonde le critère de
  sécurité central du ticket — sans elle, impossible de distinguer « les lots du client »
  de « tous les lots de son organisation ». Aucun endpoint d'écriture pour ce ticket
  (explicitement lecture seule) : une assignation se crée par l'ORM, pas par l'API — une
  UI/API d'assignation viendrait d'un futur ticket, hors scope ici.

**Tout calcul vit dans `apps/home/services.py`, jamais dans le frontend** (critère
d'acceptation central) :
- `Milestone` ne porte jamais directement de `TrustEvent` dans ce projet (voir sections
  Append-only et GED ci-dessus : les événements portent sur `WorkDeclaration`, `Evidence`,
  `Inspection`, `Reserve`) — le statut d'un jalon se dérive donc du dernier événement
  parmi TOUTE la chaîne d'objets qui s'y rattachent transitivement
  (`compute_milestone_status`).
- La progression (`progress_percentage`) est une moyenne pondérée par palier
  (`LEVEL_PROGRESS_FRACTION` : declare=20/documente=40/controle=60/verifie=80/valide=100,
  aucun jalon=0), pas un simple compte de jalons `valide` — celui-ci resterait proche de
  0% pour la plupart des lots, `Inspection` ne posant `TrustLevel.VALIDE` que via la levée
  d'une réserve (ticket 005), jamais sur un jalon inspecté `conforme` sans réserve
  (plafonné à `verifie`). Formule assumée et documentée dans `services.py`, pas une
  doctrine préexistante.
- Le « problème principal » (V3.0 §26.1) est la réserve ouverte la plus récente dont le
  statut dérivé (`apps.inspections.services.get_reserve_status`) n'est pas terminal
  (`get_open_reserve`) — absente du payload si aucune réserve n'est ouverte.
- Le frontend (`apps/home/src`) ne fait strictement AUCUN calcul : `toTrustEventData`
  (`src/api/types.ts`) ne fait que renommer des clés snake_case → camelCase pour
  `StatusBadge`, jamais dériver une valeur.

**Sécurité — le client ne voit que SES lots, jamais tous ceux de son organisation** :
`apps.home.views._ClientLotScopedView.get_lot_or_404` résout le `Lot` UNIQUEMENT via une
`LotClient` explicite pour l'utilisateur courant (même schéma que
`apps.tasks.views.MyTasksView`, ticket 006 — RLS reste un filet de sécurité en plus,
jamais le seul filtre). Un lot qui existe mais n'est pas assigné à ce client renvoie 404,
même dans la MÊME organisation que ses propres lots — testé par tentative explicite
(`apps/home/tests.py::TestClientNeverSeesAnotherLotsData`), pas par l'absence de lien
dans l'UI.

`GET /api/me/tasks/` (ticket 006) est réutilisé tel quel pour « Mes actions » — aucune
`Task` n'est aujourd'hui générée pour un rôle `client` (seul `reserve_opened` → constructeur
existe), donc cette vue reste vide en pratique tant qu'aucun futur ticket n'ajoute un
générateur de libellé ciblant le client. Vérifié manuellement dans un vrai navigateur
contre le backend réel (voir rapport de fin de ticket) — comportement attendu, pas un bug.

**Test utilisateur informel chronométré (critère produit 26.1)** : un premier passage a
révélé deux manques réels, corrigés depuis — documentés ici pour qu'un futur écran (HOME
ou ailleurs) applique le même principe dès sa conception plutôt que de redécouvrir le même
problème :
- La « prochaine action » n'apparaissait nulle part sur l'écran initial (il fallait cliquer
  sur l'onglet « Mes actions »). Corrigé par `PriorityTaskSummary`
  (`apps/home/src/views/PriorityTaskSummary.tsx`) : un résumé compact (titre + échéance +
  lien vers l'onglet complet) directement en Vue d'ensemble. Consomme **le même** endpoint
  `GET /api/me/tasks/`, avec `?status=pending&ordering=priority` — le nouveau paramètre
  `ordering=priority` (`apps/tasks/views.py::MyTasksView`) fait tout le tri côté backend
  (priorité haute d'abord, puis échéance la plus proche, `nulls_last`) ; le frontend ne fait
  que prendre `tasks[0]`, aucune logique de sélection dupliquée ni recalculée. Sans
  `ordering`, le comportement historique (le plus récent d'abord) reste inchangé — aucune
  régression pour `MyActionsView` ni pour les appelants existants de ticket 006.
- Le bandeau de réserve ouverte (« problème principal ») ne se distinguait pas
  visuellement du reste du texte — juste du gras, aucune couleur ni icône, malgré un
  `role="alert"` sémantique invisible à l'œil. Corrigé par un nouveau composant partagé du
  design system, `AlertBanner` (`packages/design-system/src/components/AlertBanner`),
  couleur + icône via un nouveau token `semanticColors.alert`
  (`packages/design-system/src/tokens/colors.ts`) — sur le même principe que
  `densityTokens` : réutilisable par un futur écran (ex : exceptions/blocages du Control
  Tower BUILD, ticket 009), pas propre à HOME. Volontairement un composant SÉPARÉ de
  `StatusBadge` : une réserve ouverte n'est pas un `TrustLevel` (voir section
  Inspections/Reserve ci-dessus), réutiliser `StatusBadge` ici aurait laissé croire, à
  tort, qu'un bandeau de réserve EST un niveau de confiance.

Les deux correctifs ont été revérifiés dans un vrai navigateur contre le backend réel
après implémentation (pas seulement via les tests automatisés) : capture DOM confirmant
les couleurs `semanticColors.alert` réellement appliquées (pas seulement présentes dans le
code), et le résumé de tâche prioritaire réellement peuplé + navigable vers l'onglet
complet.

## BUILD Production Control Tower (ticket 009)

Troisième app frontend, `apps/build` (package `@keya/build`) — même schéma que `apps/home`
(ticket 008) : `AppShell` en variante `dense`, `StatusBadge` et `AlertBanner` réutilisés
tels quels. Deux vues : **Exceptions** (par défaut, jamais un tableau de KPI — aucun champ
agrégé n'existe même dans le payload de cet endpoint, littéralement impossible d'y « faire
remonter des KPI par défaut ») et **Tous les lots** (tri/filtre/densité/pagination, écran
d'usage intensif, pas de version simplifiée).

**« Capacités manquantes » — définition explicitement choisie par l'utilisateur**, à
distinguer d'autres lectures plausibles (jalons manquants, disponibilité d'inspecteur) :
un `Lot` sans organisation constructrice affectée. Nouveau champ
`Lot.assigned_organization` (nullable, `apps/programs/models.py`) — **point d'ancrage
MINIMAL pour un futur module PRO (Professional Capability Passport, complément V4.0 §6.2),
PAS son implémentation complète** : aucun flux de candidature/opportunité, juste ce champ +
`LotViewSet.assign_organization` (`POST /api/lots/{id}/assign_organization/`) qui le pose.
Un futur ticket PRO doit ÉTENDRE ce champ et cet endpoint, jamais les redéfinir ni en créer
un second.

**Les 5 catégories d'exceptions sont calculées en un nombre de requêtes SQL BORNÉ,
indépendant du nombre de lots de l'organisation** (`apps/build/services.py`) — critère
d'acceptation central du ticket (« reste utilisable au-delà de 200 lignes ») : des requêtes
`__in=` groupées sur l'ensemble des lots de l'organisation, jamais une requête par lot dans
une boucle Python. Preuve par `CaptureQueriesContext` comparant le nombre de requêtes entre
~6 lots et 201 lots (`apps/build/tests.py::TestAllLotsScalesToTwoHundredLots`) — un temps en
millisecondes aurait été flaky (dépend de la machine), le nombre de requêtes ne l'est pas.
« Lots en retard » est une heuristique ASSUMÉE (comme la formule de progression du
ticket 008) : rien ne modélise un échéancier planifié dans ce projet — un lot est « en
retard » s'il n'a pas atteint son dernier jalon ET qu'aucune nouvelle déclaration de
travaux n'y a été faite depuis plus de `STALE_LOT_THRESHOLD_DAYS` (14 jours).

**Deux constantes déplacées vers leur app domaine propriétaire, au lieu d'être dupliquées**,
quand BUILD (second consommateur) en a eu besoin : `OPEN_RESERVE_STATUSES` (ticket 008,
`apps/home/services.py`) a migré vers `apps.inspections.services` (le domaine `Reserve`
lui-même) ; `LEVEL_PROGRESS_FRACTION` (ticket 008) a migré vers un nouveau
`apps/trust/services.py` (le domaine `TrustLevel`). HOME et BUILD importent désormais tous
les deux depuis ces emplacements uniques — deux copies auraient pu diverger silencieusement
et afficher un pourcentage différent pour le même lot selon l'écran.

**Sécurité — rappel critique explicite du ticket** : aucune action de BUILD ne permet à un
rôle constructeur de modifier directement le statut d'une réserve (garde déjà posée au
ticket 005). L'action réelle sur une réserve ouverte est « Documenter une correction »
(`POST /api/reserve-corrections/`, crée un `TrustEvent` `correction_proposee` — ne résout
JAMAIS la réserve elle-même, seule une réinspection peut le faire). Vérifié à trois niveaux
indépendants : le backend (`apps/build/tests.py::TestConstructeurCannotChangeReserveStatusFromBuild`,
tentative explicite sur `InspectionViewSet.create` et `ReserveViewSet` en écriture), le
frontend (`ExceptionsView.test.tsx`, scan de TOUS les boutons rendus contre une liste de
formulations interdites), et manuellement dans un vrai navigateur (scan JS de
`document.querySelectorAll('button')` sur les deux vues, aucun résultat).

**Piège pytest découvert en écrivant ce ticket** : `norecursedirs` par défaut de pytest
inclut `build` (pensé pour des répertoires de sortie de compilation) — `apps/build/tests.py`
était donc **silencieusement exclu** de la suite complète (`pytest` sans argument), alors que
`pytest apps/build` seul le trouvait (un chemin explicite contourne `norecursedirs`). Détecté
en comparant le nombre de tests collectés par la suite complète à la somme des suites par
app — jamais supposé qu'un compte qui « semble stable » entre deux runs est forcément
complet. Corrigé dans `pytest.ini` (`norecursedirs` explicite, sans `build`). À surveiller
si un futur module ajoute un dossier nommé `dist`, `venv`, ou toute autre valeur de la
liste par défaut de pytest.

## CONTROL PWA — mobile offline (ticket 010, passe 1)

Quatrième app frontend, `apps/control-pwa` (package `@keya/control-pwa`) — **la première PWA
du monorepo**, distincte des trois précédentes à plusieurs égards volontaires :

- **Pas d'`AppShell`** (contrairement à HOME/BUILD) : conçu pour un layout desktop
  dense/confortable (sidebar + topbar), pas pour un écran tactile 360-430px. Seul
  `AlertBanner` (ticket 007/008) est réutilisé, pour l'indicateur hors ligne — un vrai
  troisième consommateur, confirmant que le promouvoir au design system au ticket 008 était
  justifié.
- **Aucun backend touché** : ce ticket est explicitement découpé en deux passes par
  l'utilisateur ; cette passe ne couvre QUE l'app + IndexedDB + l'horodatage double, jamais
  la synchronisation réseau réelle (passe 2). Aucun fichier `backend/` n'est modifié par
  cette passe — les « missions » sont une liste statique en mémoire
  (`src/db/missions.ts::MOCK_MISSIONS`), pas un fetch, faute d'un concept de « mission
  assignée à un inspecteur » côté backend aujourd'hui (`apps/tasks` ne génère que des Task
  pour le rôle constructeur, voir section Task Inbox ci-dessus).

**Toute saisie est écrite en IndexedDB IMMÉDIATEMENT** (`InspectionFormView.tsx::persist`),
jamais différée jusqu'à un bouton « Enregistrer » final — chaque coche de checklist, ajout/
suppression de photo, sélection de décision déclenche une écriture ; le commentaire se
sauvegarde au blur (pas à chaque frappe, pour limiter le nombre d'écritures, mais jamais
seulement à la fermeture). C'est ce qui garantit qu'aucune saisie n'est perdue si
l'inspecteur ferme l'app à n'importe quel moment, pas seulement s'il pense à valider avant
de quitter.

**Modèle `InspectionDraft`** (`src/db/types.ts`) : `correlationId` généré côté client
(`crypto.randomUUID()`) DÈS la création du brouillon — condition posée par le ticket pour
la traçabilité de bout en bout côté serveur, une fois la passe 2 construite. `syncStatus`
modélise déjà les 4 valeurs (`pending/syncing/synced/conflict`) même si SEUL `pending` est
atteignable cette passe (aucune logique n'existe pour en faire progresser un) — pour que la
passe 2 n'ait pas à migrer le schéma IndexedDB. `deviceTimestamp` reposé à chaque
sauvegarde ; `serverTimestamp` reste `null` tant qu'aucune synchronisation n'a jamais eu
lieu — les deux champs existent dès cette passe précisément pour pouvoir un jour révéler
une dérive d'horloge entre appareil et serveur, mais rien ne les compare encore.

**`SyncStatusIndicator`** (`src/components/`) : PAS `StatusBadge` du design system —
`pending/syncing/synced/conflict` n'est pas un des 5 niveaux Visible Trust, même
raisonnement qu'`AlertBanner` vs `StatusBadge` (ticket 008). Local à cette app pour
l'instant, pas encore promu au design system — aucun second consommateur ne l'a réclamé.

**Piège d'outillage découvert en écrivant le test de persistance des photos** : le `Blob`
de jsdom (utilisé par défaut pour tout `new Blob(...)` sous Vitest+jsdom) n'est PAS reconnu
par `structuredClone` — un Blob jsdom cloné revient comme un objet générique SANS ses
méthodes (`.text()` etc.), silencieusement. `fake-indexeddb` utilise ce même mécanisme de
clonage en interne pour simuler l'algorithme de structured clone qu'utilise un vrai
IndexedDB de navigateur — sans correctif, un test de persistance de photo aurait
« réussi » en comparant des objets vides des deux côtés, un faux positif dangereux pour
EXACTEMENT le critère d'acceptation central de cette passe. Corrigé dans
`src/setupTests.ts` : `globalThis.Blob` réassigné au `Blob` natif de `node:buffer` avant
l'exécution des tests — un vrai navigateur n'a pas ce problème (ce correctif aligne
uniquement l'environnement de test sur le comportement réel, ne change rien en production).
Même fichier : polyfill minimal de `URL.createObjectURL`/`revokeObjectURL`, absents de
jsdom, utilisés pour prévisualiser une photo sans relecture asynchrone du Blob.

**Critère d'acceptation central de cette passe, vérifié à deux niveaux** :
1. `src/db/repository.test.ts` — au niveau de la couche de données seule (sans React),
   contre une vraie IndexedDB polyfillée (`fake-indexeddb`, pas un mock de notre code) :
   écrit un brouillon complet (checklist/commentaire/décision/2 photos), ferme
   explicitement la connexion, en rouvre une NOUVELLE (jamais de singleton mis en cache
   dans `db.ts`, précisément pour que ce test puisse le prouver), relit, vérifie chaque
   champ individuellement y compris le contenu binaire réel des photos (`blob.text()`),
   et vérifie qu'aucun appel réseau n'a eu lieu.
2. `src/App.test.tsx` — au niveau applicatif complet : `navigator.onLine = false` posé
   AVANT la première saisie, saisie intégrale pilotée via l'UI (checklist, 2 photos,
   commentaire, décision), `unmount()` du composant racine pour détruire tout état React
   en mémoire (simulant une fermeture totale de process), nouveau `render(<App />)`, et
   vérification que TOUT est restauré — y compris l'horodatage device, comparé
   directement en base entre les deux "sessions", pas seulement via l'état React affiché
   (qui pourrait survivre par accident de portée mémoire du test plutôt que par une vraie
   relecture).

**Vérifié aussi manuellement dans un vrai navigateur** (pas seulement les tests
automatisés) : saisie complète avec une vraie photo JPEG (40×40, vérifiée par upload de
fichier réel, pas un mock), confirmation via `read_network_requests` qu'aucune requête
n'atteint un serveur pendant toute la saisie (seules des requêtes `blob:` locales et le
bruit de l'extension de navigateur elle-même), fermeture RÉELLE de l'onglet Chrome
(`tabs_close_mcp`, pas juste une navigation), réouverture dans un nouvel onglet : checklist,
commentaire, décision et photo (dimensions 40×40 exactes, revérifiées via
`img.naturalWidth`/`naturalHeight` après chargement du Blob) tous intégralement retrouvés.

**Passe 1 s'arrêtait ici** : synchronisation réseau réelle, résolution de conflit,
compression photo avant upload, retry avec backoff — tout cela est désormais construit,
voir la section suivante.

## CONTROL PWA — synchronisation réelle (ticket 010, passe 2)

Construite sur les fondations de la passe 1 (IndexedDB, `syncStatus`, horodatage double,
`correlationId`) — aucune n'a été remise en cause, seulement complétée.

**Backend touché pour la première fois par ce ticket** — nouvelle app `apps/control`
(label `control_sync`), volontairement **une couche d'API fine, aucune logique métier
propre** : chaque endpoint délègue à `apps.inspections.services`/`apps.evidence.services`
déjà validés (tickets 003/004/005), jamais réinventés. Trois routes, `POST
/api/control/sync/{documents,evidence,inspection}/`, réservées au rôle `inspecteur`
(`IsInspecteur`, ticket 005) :

- **`SyncDocumentView`/`SyncEvidenceView`** : un inspecteur n'est JAMAIS membre de
  l'organisation cible (règle d'indépendance, ticket 005) — `apps.evidence.services.
  create_document`/`create_evidence` ne basculent pas eux-mêmes le contexte RLS (aucun
  appelant antérieur n'en avait besoin, chacun agissait dans sa propre organisation).
  `apps/control/services.py::sync_document`/`sync_evidence` reprennent donc exactement le
  même schéma que `create_inspection` (ticket 005) : bascule explicite du contexte RLS vers
  l'organisation cible, restaurée dans un `finally`, jamais un contournement général.
- **`SyncInspectionView`** : cible TOUJOURS `work_declaration` (jamais `evidence`) —
  volontaire. Les photos de l'inspecteur transitent par leur propre `Evidence`, synchronisée
  séparément via `SyncEvidenceView` : c'est ce qui garantit qu'un échec d'upload photo ne
  bloque JAMAIS la synchronisation de la checklist/du commentaire/de la décision (critère
  d'acceptation explicite de cette passe). Une `Evidence` peut donc exister avant, après, ou
  en l'absence de toute `Inspection` synchronisée pour un même brouillon.

**Détection de conflit — la règle la plus importante de cette passe : jamais de
last-write-wins silencieux.** Ajoutée à `apps.inspections.services.create_inspection`
lui-même (pas un wrapper séparé) via deux paramètres optionnels, tous deux à valeur par
défaut neutre pour que TOUT appelant antérieur (`InspectionViewSet.create`, tickets
001-009) garde un comportement rigoureusement inchangé :
- `expected_latest_event_id` (sentinelle `_NOT_CHECKING_CONFLICT` par défaut, distincte de
  `None` : `None` explicite signifie « je m'attends à ce qu'aucun événement n'existe encore
  pour cette cible », absence de paramètre signifie « ne vérifie rien »). La vérification a
  lieu DANS `_create_inspection_row`, donc dans la MÊME transaction que la création qui
  suit — aucune fenêtre de course possible entre « je vérifie » et « j'écris ».
- `client_correlation_id`, posé directement sur `Inspection.client_correlation_id` (nouveau
  champ, migration 0004) à la création — traçabilité de bout en bout : loggé à chaque étape
  (`apps/control/services.py`, `logger.info`/`warning` avec `correlation_id=...`) et exposé
  en lecture par `InspectionSerializer`.

**Traçable même quand RIEN n'est écrit en base (cas `conflict`)** : un item rejeté ne
produit aucune ligne `Inspection` (voir `SyncConflict` ci-dessus) — le correlation ID n'a
donc, dans ce cas précis, que deux points d'ancrage : la réponse HTTP elle-même
(`SyncInspectionView.post` renvoie `correlation_id` dans le corps du 409, symétrique avec
le 201 qui le porte via `InspectionSerializer`) et les logs serveur
(`control_sync_inspection_conflict correlation_id=...`, niveau `WARNING`). Les deux sont
testés explicitement, y compris que le log de conflit porte le correlation ID du bon item
et jamais celui d'un envoi voisin qui a réussi
(`apps/control/tests.py::TestSyncInspectionConflictObservability`) — c'est précisément dans
ce cas (rien à relire en base) qu'on en a le plus besoin pour reconstituer, après coup, ce
qui s'est passé sur le terrain.

**Piège de conception découvert en écrivant les tests (`apps/control/tests.py`) — la
cible du conflit n'est PAS le `WorkDeclaration`/`Evidence` lui-même** : son propre
`TrustEvent` (`declare`/`evidence_upload`) existe dès sa création par le CONSTRUCTEUR, sans
aucun rapport avec une inspection concurrente. Comparer contre cet événement aurait fait
échouer en conflit TOUTE première inspection sur un `work_declaration` normal — détecté par
un test qui échouait alors qu'il n'aurait pas dû (`test_first_sync_of_a_fresh_target_
succeeds...`). Corrigé : sans `reserve` fournie, la cible du conflit est la DERNIÈRE
`Inspection` déjà enregistrée sur ce `work_declaration`/`evidence` (via son propre événement
`inspection_<outcome>`), `None` si aucune n'existe encore — c'est CE `None` qui doit
correspondre à ce que le client connaît pour qu'une première inspection passe. Avec une
`reserve` fournie (inspection de suivi), la cible reste la réserve elle-même, sans ce piège
(son propre événement `ouverte` EST la bonne référence).

**Testé explicitement (`apps/control/tests.py::TestSyncInspectionConflict`)** : deux
inspections concurrentes sur la même cible, toutes deux avec `known_latest_event_id=None`
(cas réel d'une saisie intégralement hors ligne, passe 1, où aucun état serveur n'a jamais
été observé) — la première réussit (201), la seconde est rejetée (409, `status: conflict`)
SANS qu'aucune donnée ne soit écrasée : une seule `Inspection` existe en base, avec la note
du premier envoi intacte. Testé à la fois sur un `work_declaration` frais et sur une
`Reserve` déjà ouverte (inspection de suivi) — les deux cibles nommées par le ticket.

**Frontend — deux files indépendantes** (`src/sync/syncEngine.ts`) :
- **File de données** : `InspectionDraft.syncStatus` progresse `pending`→`syncing`→
  `synced`/`conflict`/`pending` (retry) — jamais retentée automatiquement une fois
  `conflict` (voir `runSyncCycle`, qui ne relance que `pending`/`syncing`). `syncing` est
  éligible à une nouvelle tentative (pas seulement `pending`) : un item resté bloqué sur
  `syncing` ne peut venir que d'une interruption (app fermée pendant l'appel réseau) — le
  laisser figé serait, de fait, un abandon silencieux.
- **File média** : chaque `LocalPhoto` a son propre `mediaSyncStatus`/`retryCount`/
  `nextRetryAt`, entièrement découplé de celui du brouillon — `src/sync/syncEngine.ts::
  syncPhotos`. Compression côté client AVANT mise en queue (`src/media/compressImage.ts`,
  Canvas + `createImageBitmap`) — dégrade silencieusement vers le blob d'origine si
  l'environnement ne fournit pas ces API (jsdom en test, sans le paquet `canvas`) plutôt que
  de faire échouer toute la file pour une raison purement d'environnement.
- **Backoff exponentiel partagé** (`src/sync/backoff.ts`) : 2s/4s/8s/16s/32s, plafonné à
  60s, jamais un abandon. Déclenché à chaque transition `offline→online` ET par un sondage
  périodique (15s) tant que la connexion reste active (`startSyncEngine`) — sans ce second
  déclencheur, un item en attente de backoff n'aurait plus aucune chance d'être retenté
  avant la PROCHAINE reconnexion, qui peut ne jamais survenir si le réseau ne coupe jamais
  réellement pendant la session.

**Piège d'outillage découvert en écrivant `syncEngine.test.ts`** : `setupTests.ts`
réassigne `globalThis.Blob` au `Blob` natif de Node (correctif de la passe 1, voir
ci-dessus) — un `new Blob(...)` construit dans un test n'est donc PLUS reconnu par le
contrôle de type strict de `FormData.append` de jsdom (`TypeError: parameter 2 is not of
type 'Blob'`), qui vérifie un brand jsdom interne, pas une simple structure compatible.
Corrigé dans `src/api/client.ts::syncDocument` : le blob est enveloppé dans `new File(...)`
avant l'ajout au `FormData` — un `File` construit via l'implémentation jsdom n'est jamais
concerné par la réassignation de `Blob`, et ce changement est de toute façon correct en
production (un vrai `File`, nommé, plutôt qu'un Blob nu).

**Piège React découvert en écrivant le test de résolution de conflit** : le `<textarea>` du
commentaire est volontairement NON contrôlé (`defaultValue` + `onBlur`, voir passe 1) — mais
`resolveConflictByDiscarding` (abandon explicite d'un conflit, voir ci-dessous) remplace le
brouillon affiché par un composant DÉJÀ MONTÉ, sans jamais démonter/remonter le formulaire.
React ne réapplique jamais `defaultValue` sur un composant non démonté : le commentaire
affiché restait silencieusement celui de l'ANCIEN brouillon. Corrigé par `key={draft.id}`
sur le `<textarea>` — force un vrai remount quand l'identité du brouillon change.

**Résolution de conflit construite dans cette passe** : un item `conflict` reste visible
(bandeau `AlertBanner`, jamais `StatusBadge` — même raisonnement que le hors-ligne) avec le
dernier événement serveur connu affiché, et une seule action explicite disponible —
« Ignorer ma saisie et recommencer » (`InspectionFormView.tsx::
resolveConflictByDiscarding`) : supprime le brouillon local, repart d'un formulaire vierge
en connaissance du nouvel état.

**Abandon explicite seul (pas de fusion, pas d'arbitrage) : choix produit assumé pour le
MVP, PAS une limite provisoire à corriger au prochain sprint** — voir
`docs/adr/0002-control-conflict-resolution-discard-only.md` pour la décision complète et
ses raisons. Une résolution avec fusion assistée ou arbitrage par un rôle habilité distinct
de l'inspecteur (mentionné par le ticket) est explicitement reportée, et ne sera
ticketisée QUE si ce scénario se révèle fréquent en usage réel pendant le pilote —
mesurable via les logs serveur (`control_sync_inspection_conflict`,
`apps/control/services.py`). Le mécanisme de DÉTECTION, lui, n'a pas besoin d'être revu si
cette décision est révisée plus tard : seule l'action proposée à l'inspecteur changerait.

**Limite connue, non résolue par cette passe** : `InspectionDraft.knownLatestEventId` reste
`null` pour tout brouillon saisi hors ligne (aucun mécanisme de rafraîchissement de l'état
connu pendant la saisie n'est construit ici — hors du scope littéral du ticket, qui ne
demandait qu'une file de synchronisation, une détection de conflit et une file média). Le
mécanisme de conflit lui-même reste réel et testé (voir plus haut, en construisant
directement les deux brouillons concurrents) ; seule la façon dont un client apprendrait un
état serveur plus récent AVANT de synchroniser reste un point d'extension futur.

**Missions mock, toujours sans correspondance backend par défaut** (limite déjà documentée
passe 1, non résolue ici) : `MOCK_MISSIONS` porte désormais `organizationId`/
`workDeclarationId`, mais ce sont des UUID fictifs — une vraie vérification manuelle exige
de les remplacer temporairement par de vrais identifiants backend (jamais commité tel quel).
Les tests automatisés n'en ont pas besoin : l'API est mockée (`vi.stubGlobal('fetch', ...)`).

## Messagerie & Back-office (ticket 011)

**`Message`** (`apps/messaging`) — toujours rattaché à un objet métier existant (Lot,
Reserve, Document), jamais une messagerie libre. Référence polymorphe exactement comme
`TrustEvent`/`Task` (`subject_type`/`subject_id` via `contenttypes`), restreinte en
pratique par `services.py::ALLOWED_SUBJECT_MODELS = (Lot, Reserve, Document)` — vérifiée
explicitement dans `create_message`, pas seulement présumée par construction des appelants.
`organization` dénormalisé depuis le sujet (même pattern que `Asset.organization`), policy
RLS standard par colonne (`organization_id = current_org`, migration 0002).

**Aucune route propre à `apps/messaging`** : les endpoints vivent en `@action(detail=True,
methods=['get','post'])` directement sur `LotViewSet`/`ReserveViewSet`/`DocumentViewSet`
existants (`GET/POST /api/{lots,reserves,documents}/{id}/messages/`), via
`MessageThreadMixin` (`apps/messaging/mixins.py`) — c'est ce qui permet d'hériter des
permissions déjà en place (`get_object()` de chaque ViewSet) **sans écrire de nouvelle
logique de permission**, critère d'acceptation explicite du ticket. Un membre qui ne peut
pas lire un Lot/une Reserve/un Document (organisation active, RLS) ne peut, par
construction, ni lire ni écrire ses messages.

**Nuance `Document` — point d'extension du mixin** : `get_object()` seul ne suffit PAS pour
un `Document` : un document `confidentiel` doit rester exclu de tout membre qui n'en est ni
le propriétaire ni `admin_keyimmo` (`apps.evidence.access.user_can_access_document`, ticket
004). `MessageThreadMixin.get_message_subject()` est le point d'extension prévu pour ça —
`DocumentViewSet` le surcharge pour appeler cette fonction EXISTANTE (jamais une seconde
règle), tout en laissant `get_object()` lui-même inchangé : `RetrieveModelMixin`/
`signed_url` gardent leur comportement du ticket 004, hors scope de ce ticket.

**Piège rencontré : `DocumentViewSet.parser_classes = [MultiPartParser]`** (fixé au niveau
CLASSE, nécessaire pour `create` qui reçoit un fichier) est hérité par TOUTE action montée
dessus, y compris `messages` — un corps JSON `{"body": "..."}` y était rejeté en 415.
Corrigé en déclarant `parser_classes` explicitement sur l'action elle-même (`@action(...,
parser_classes=[JSONParser, FormParser, MultiPartParser])`), dans `MessageThreadMixin` —
robuste quel que soit le ViewSet hôte.

**Limite héritée, pas résolue par ce ticket** : un inspecteur n'étant jamais membre de
l'organisation cible (règle d'indépendance, ticket 005), il ne peut ni lire ni écrire de
message sur une Reserve cross-organisation via cette route — exactement la même limite déjà
documentée par `create_inspection` pour la relecture de ses propres inspections. Ticket 011
hérite cette limite plutôt que de la résoudre (aurait exigé une nouvelle logique de
permission cross-org, explicitement hors de ce que le ticket demande).

**Back-office** (`apps/backoffice`, réservé à `admin_keyimmo`) — `IsAdminKeyimmo` diffère
volontairement d'`IsInspecteur`/`IsConstructeur` (ticket 005) : ces derniers vérifient le
rôle DANS l'organisation ACTIVE de la requête, alors qu'un back-office est par nature une
capacité transverse à toutes les organisations — `IsAdminKeyimmo` vérifie que l'utilisateur
détient `admin_keyimmo` dans N'IMPORTE LAQUELLE de ses organisations
(`Membership.objects.filter(user=request.user, role__code='admin_keyimmo')` — passe sans
problème la policy RLS existante, ticket 001, puisque c'est une lecture de SES PROPRES
lignes).

**Tentative abandonnée, documentée pour ne pas être retentée à l'identique** : élargir
`membership_select` (ticket 001, `user_id = current_user` strictement) avec une branche `OR
EXISTS (SELECT ... FROM organizations_membership ...)` pour qu'un `admin_keyimmo` lise
n'importe quelle ligne. Postgres détecte une **récursion infinie** dans une policy qui
référence sa propre table sous `FORCE ROW LEVEL SECURITY` (`InvalidObjectDefinition`,
« récursion infinie détectée dans la politique »). La parade usuelle (fonction
`SECURITY DEFINER` + `SET row_security = off`) échoue elle aussi pour la MÊME raison
structurelle : `FORCE ROW LEVEL SECURITY` interdit explicitement de désactiver la RLS par ce
biais, même pour le propriétaire de la table (`InsufficientPrivilege` : « la requête
pourrait être affectée par une politique de sécurité »). Cassait TOUTE requête sur
`organizations_membership`, testée ou non — retrouvé et corrigé en local avant tout commit,
jamais poussé en l'état.

**Solution retenue** (`apps/backoffice/services.py::get_user_memberships`) : basculer
temporairement `app.current_user_id` sur l'utilisateur CIBLE, le temps de CETTE lecture
seule — ses propres lignes deviennent visibles sous la policy EXISTANTE, INCHANGÉE, sans
élargissement. Restauré dans un `finally`, même schéma que
`apps.inspections.services.create_inspection` (ticket 005) : une exception étroite et
documentée par appel, jamais un contournement général de RLS, et aucune migration touchant
`organizations_membership` n'a été nécessaire.

**Désactivation de compte** (`services.py::deactivate_user`) : `User.is_active = False`,
rien d'autre — aucune donnée (`TrustEvent`, `Message`, `Document`, `Membership`) n'est
touchée. Bloque l'accès IMMÉDIATEMENT parce que `JWTAuthentication.get_user`
(`rest_framework_simplejwt`) revérifie `is_active` à CHAQUE requête authentifiée (pas
seulement à l'émission du token) — aucun mécanisme de révocation/blacklist de token n'a été
nécessaire, le comportement existe déjà dans la bibliothèque.

**Bug réel trouvé en écrivant le test de désactivation avec un JWT déjà émis** :
`apps.core.middleware.OrganizationScopeMiddleware._authenticate` ne rattrapait QUE
`(InvalidToken, TokenError)` — pas `AuthenticationFailed`, que `JWTAuthentication.get_user`
lève pourtant pour un utilisateur `is_active=False` (jeton par ailleurs valide). Un jeton
émis avant une désactivation provoquait une 500 non gérée à la requête suivante (l'exception
remontait telle quelle depuis le middleware, avant même la gestion d'exceptions de DRF, qui
ne s'exécute qu'à l'intérieur d'une vue), au lieu du 401 attendu. Corrigé en ajoutant
`AuthenticationFailed` au tuple rattrapé — bug préexistant (aucun ticket avant le 011 n'avait
de scénario qui l'exerçait), révélé uniquement parce que le critère d'acceptation exigeait de
prouver le blocage AVEC un jeton déjà émis, pas seulement une tentative de connexion après
coup.

**Garde anti-court-circuit TrustEvent** (critère d'acceptation explicite du ticket) :
`apps/backoffice/tests.py::TestBackofficeNeverExposesATrustEventShortcut` scanne le code
source réel de `views.py`/`services.py` (pas seulement une revue manuelle) — absence de
`apps.trust`, d'appel `trust_repository.create`/`TrustEvent.objects.create`, ET vérifie que
les routes de `apps/backoffice/urls.py` sont EXACTEMENT celles documentées (toute route
supplémentaire future fait échouer ce test, obligeant une décision consciente — exercé
une première fois au ticket 012, qui a ajouté `backoffice-mission-create` : le test a
correctement forcé sa propre mise à jour explicite plutôt que de laisser passer l'ajout
silencieusement). Même famille de test que la garde anti-attribution KEYIMMO (ticket 006)
et la garde de gouvernance StatusBadge (ticket 007) : scanner le code, pas seulement le
comportement actuel.

## Affectation de mission à un inspecteur (ticket 012)

Comble l'angle mort révélé par le test bout-en-bout du vertical slice (doctrine V3.0
§22.4) : `CONTROL PWA` n'avait jamais consommé de vraie liste de missions
(`MOCK_MISSIONS`, ticket 010, retiré). Résout au passage la limite documentée dès le
ticket 005 : « l'inspecteur ne peut pas relire ses inspections passées via l'API —
nécessiterait une requête cross-organisation dédiée ».

**`InspectionMission`** (`apps/inspections/models.py`) — modèle SÉPARÉ, pas une
réutilisation de `Task` (ticket 006). `Task` reste utilisée, mais uniquement comme effet
de bord de notification, exactement le rôle qu'elle joue déjà pour `Reserve`. Trois
décisions de conception, validées par l'utilisateur avant implémentation (voir
`012-affectation-mission-inspecteur.md`, section « Décisions de conception ») :
1. Seul `admin_keyimmo` peut créer une affectation — laisser le constructeur choisir
   (même indirectement) son propre inspecteur affaiblirait la règle d'indépendance dès
   l'affectation, avant même la première inspection.
2. Modèle séparé de `Task`, dans `apps.inspections` (le domaine qui possède déjà la règle
   d'indépendance) — `Task` n'a pas vocation à arbitrer une règle métier aussi spécifique.
3. `GET /api/control/missions/`, scopé sur `assigned_inspector_id = current_user`.

**Aucun champ statut stocké** (contrairement à `Task`) : une mission est « faite » si une
`Inspection` existe déjà pour son `work_declaration`, créée par l'inspecteur assigné —
entièrement dérivé (`services.py::list_missions_for_inspector`), la doctrine Visible
Trust appliquée sans exception cette fois.

**Policy RLS par comparaison de colonne, pas de sous-requête** (migration 0006) :
`organization_id = current_org OR assigned_inspector_id = current_user`. Décidé et
validé AVANT implémentation, précisément pour éviter le piège du ticket 011 (une
sous-requête `OR EXISTS (SELECT ... FROM organizations_membership ...)` référençant sa
propre table avait déclenché une récursion infinie sous `FORCE ROW LEVEL SECURITY`) — une
simple comparaison de colonne n'a jamais ce problème, structurellement identique à la
policy `membership_select` d'origine (`user_id = current_user`, ticket 001), qui a
toujours fonctionné. La CRÉATION reste stricte (`organization_id = current_org` seul,
INSERT non élargi) : `admin_keyimmo` écrit en empruntant explicitement le contexte RLS de
l'organisation cible (`create_mission`), même schéma que `create_inspection`.

**Piège rencontré en écrivant le test bout-en-bout** (`apps/control/tests.py::
TestMissionListView`) : `list_missions_for_inspector` faisait initialement
`InspectionMission.objects.filter(...).select_related('work_declaration__milestone__lot__
asset__program')`. `select_related` compile un INNER JOIN — `work_declaration`/`lot` sont
protégés par la policy RLS STANDARD SEULE (`organization_id = current_org`, sans la
branche `assigned_inspector` ajoutée à `InspectionMission`). Sous le contexte de
l'inspecteur (son organisation active, jamais celle de la cible), ces tables jointes
deviennent invisibles à RLS et le JOIN élimine la ligne entière — alors même que
`InspectionMission` aurait été visible seule. Corrigé : la requête initiale ne charge que
`InspectionMission` ; la traversée lot/bien/programme se fait dans la boucle, sous le
contexte de l'organisation CIBLE déjà basculé pour lire `Inspection` (même bascule
explicite, réutilisée pour les deux lectures). **Leçon générale, au-delà de ce ticket** :
`select_related`/toute jointure implicite sur une table RLS-élargie doit être vérifiée
contre les policies des tables JOINTES, pas seulement celle de la table de départ.

**Côté `CONTROL PWA`** — `MOCK_MISSIONS` intégralement retiré du code de production.
`GET /api/control/missions/` consommé par `sync/syncEngine.ts::refreshMissions`,
déclenché avant chaque cycle de synchronisation (`runIfOnline`), résultat mis en cache
IndexedDB (`db.ts` passé en version 2, nouvel object store `missions` — `upgrade()`
étendu avec des branches `if (oldVersion < N)`, jamais un remplacement, pour ne pas
recréer `inspection_drafts` sur une base déjà en v1). `MissionsListView`/
`InspectionFormView` lisent ce cache (`getCachedMissions`/`getCachedMission`), jamais un
fetch direct — même principe « local d'abord » que les brouillons.

**Deux pièges d'outillage réels trouvés en réécrivant les tests frontend** (`MOCK_MISSIONS`
retiré cassait plusieurs fichiers de test, remplacés par une fixture partagée
`src/testUtils/missionFixtures.ts`) :
- `repository.ts::saveMissions` attendait `tx.store.clear()` individuellement avant les
  `put()` suivants — une transaction IndexedDB se termine automatiquement dès que la
  boucle d'événements se vide sans nouvelle requête en attente sur elle ; attendre `clear()`
  seul laissait le temps à la transaction de se clôturer avant les `put()`, le cache
  restant silencieusement vide. Corrigé en lançant `clear()` et tous les `put()` dans le
  même tick (sans `await` individuel), puis en n'attendant qu'une fois sur `tx.done` —
  pattern `idb` standard.
- `testUtils/clearIndexedDB.ts` (nouveau, remplace le motif `deleteDatabase` fire-and-forget
  jusque-là dupliqué dans chaque fichier de test) résolvait à tort sur l'événement
  `onblocked` — une connexion IndexedDB tenue par un composant démonté ENTRE deux tests
  (`MissionsListView`, dont l'effet ne bloque volontairement pas son rendu sur sa
  résolution complète) bloque la suppression ; résoudre immédiatement dessus laissait la
  VRAIE suppression s'exécuter plus tard, en arrière-plan — parfois APRÈS que le test
  suivant ait déjà reseedé ses données, les faisant disparaître silencieusement (flaky,
  reproduit de façon déterministe en isolant la séquence de tests en cause). Corrigé en ne
  résolvant que sur le VRAI `onsuccess` — nos fonctions de `repository.ts` ferment
  toujours leur connexion dans un `finally`, donc le blocage se résout naturellement en
  quelques ticks, sans qu'aucun minuteur ne soit nécessaire.

## Correction des bugs bloquants CONTROL PWA (ticket 013)

Pas une nouvelle fonctionnalité — correction de bugs sur du code déjà livré aux tickets
010 et 012, révélés par le test bout-en-bout du vertical slice MVP 1 (doctrine V3.0
§22.4). Documenté rétroactivement (voir `013-correction-bugs-control-pwa.md`) : cette
section et le fichier ticket n'existaient pas au moment du commit initial (`e6f1127`) —
rupture ponctuelle de la discipline documentaire suivie depuis le ticket 001, rattrapée
lors d'un état des lieux du projet après une pause.

**Trois bugs corrigés dans le parcours CONTROL PWA** : 1) un brouillon sans décision
explicite tombait silencieusement dans la branche « conforme » de `syncDraft`
(`apps/control-pwa/src/sync/syncEngine.ts`) — reste désormais en `pending` indéfiniment,
jamais synchronisé automatiquement ; 2) `InspectionDraft.knownLatestEventId` n'était
jamais rafraîchi après une synchronisation réussie (le backend n'exposait pas
`latest_event_id` sur une réponse "applied") — provoquait un conflit permanent dès la
tentative suivante, même légitime ; 3) `list_missions_for_inspector`
(`apps/inspections/services.py`) ne calculait ni `reserve_id` ni
`reserve_latest_event_id` par mission — un inspecteur ne pouvait structurellement jamais
lever une réserve via l'app réelle, faute de savoir quelle réserve une mission de suivi
concernait. Les trois sont désormais couverts par un test qui reproduisait le bug avant
correction (`syncEngine.test.ts`, `apps/control/tests.py`).

**Quatrième bug, trouvé en relançant la suite complète après coup** : le test introduit
avec le bug 3 (`apps/control/tests.py::TestMissionListView::
test_mission_row_reserve_id_is_null_once_the_reserve_is_resolved`) était committé rouge —
`apps.trust.repository.get_current_status` triait uniquement par `-created_at`, sans
tie-break. `_advance_existing_reserve` (`apps/inspections/services.py`) crée coup sur
coup deux `TrustEvent` sur la même réserve dans la même transaction
(`nouvelle_inspection` puis `levee`/`rejetee`, sans commit intermédiaire) — un
`created_at` trop proche pouvait faire remonter `nouvelle_inspection` (encore dans
`OPEN_RESERVE_STATUSES`) au lieu de l'événement terminal réel, laissant
`list_missions_for_inspector` exposer un `reserve_id` pour une réserve pourtant résolue.

**Correctif — `TrustEvent.sequence`** (migration `apps/trust/migrations/
0004_trustevent_sequence.py`) : PAS un `AutoField` — Django exige `primary_key=True` sur
tout `AutoField` (`fields.E100`), incompatible avec la pk UUID de `TrustEvent`. C'est un
`BigIntegerField` alimenté explicitement dans `TrustEvent.save()` via `nextval()` sur une
séquence Postgres dédiée (`trust_event_sequence_seq`), posée aussi comme `DEFAULT` de la
colonne côté DB pour tout insert hors ORM (même esprit que les trois couches de défense
déjà documentées pour l'append-only lui-même) — garantit un ordre d'insertion strict,
jamais recalculable après coup. `get_current_status`/`list_for_subject`
(`apps/trust/repository.py`) trient désormais par `(-created_at, -sequence)`, jamais
`-created_at` seul.

**Piège de migration** : `trust_event` porte le trigger append-only (migration 0002) ET
aucune policy RLS `UPDATE` — les deux bloquent normalement tout `UPDATE`, y compris pour
le rôle propriétaire de la table (voir section Append-only ci-dessus). Le backfill de
`sequence` sur des lignes existantes (`UPDATE trust_event SET sequence = ...`) aurait donc
été silencieusement bloqué (RLS) ou aurait levé l'exception du trigger — les deux ont dû
être levées explicitement (`ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` +
`DISABLE TRIGGER trust_event_no_update`) puis restaurées avant la fin de la même
transaction de migration, jamais un affaiblissement permanent de l'invariant.

**Même défaut de tri dupliqué, trouvé et éliminé à la source** : le même problème
existait aussi dans trois lectures directes de `TrustEvent` qui ne passaient pas par
`apps.trust.repository` — `apps/build/services.py::_bulk_open_reserves` et
`apps/home/services.py::compute_milestone_status`/`get_latest_notable_event`. Corrigé en
centralisant l'ordre plutôt qu'en le corrigeant trois fois : `apps.trust.repository.
LATEST_FIRST_ORDERING` (nouveau tuple public `('-created_at', '-sequence')`) est
désormais le SEUL endroit qui définit cet ordre — `list_for_subject` l'utilise en
interne, les trois lectures directes l'importent plutôt que de dupliquer `'-created_at'`
en dur (`_bulk_open_reserves`, qui a besoin de `subject_id` en tête pour son `DISTINCT
ON`, fait `.order_by('subject_id', *trust_repository.LATEST_FIRST_ORDERING)`).

**Test de garde** (`apps/trust/tests.py::TestNoDirectTrustEventOrderingOutsideRepository`)
: scanne via `ast` le code source réel de chaque fichier de `apps/` (hors
migrations/tests/`apps/trust/repository.py` lui-même) et détecte tout futur
`.order_by(...)` appliqué à un queryset `TrustEvent` — directement, ou via une fonction
locale dont le corps référence `TrustEvent` (ex. `_lot_trust_events_queryset`) — dont les
arguments contiennent `created_at` sans `sequence`. Même famille de test que
`TestNoTaskLabelGeneratorAttributesDecisionToKeyimmo` (ticket 006) et la gouvernance
StatusBadge (ticket 007) : empêche cette classe de bug de réapparaître silencieusement,
même ailleurs dans le projet, plutôt que de compter sur la vigilance d'une revue
manuelle. Vérifié qu'il détectait bien les 3 violations réelles avant le refactor.

## Frictions UX du rapport bout-en-bout (ticket 014)

Trois frictions UX/correction réelles identifiées par le même test bout-en-bout du
vertical slice MVP 1 (doctrine V3.0 §22.4) que le ticket 013, laissées de côté à
l'époque — voir `014-frictions-ux-vertical-slice.md` pour le détail complet. Chacune
corrigée avec un test qui reproduisait le problème AVANT correction.

**Missions indistinguables dans CONTROL PWA** : `MissionsListView.tsx` n'affichait ni
`reserve_id` ni aucun moyen de distinguer une première inspection d'une mission de suivi
— deux entrées de liste strictement identiques. Corrigé par `MissionTypeIndicator`, un
composant LOCAL à cette app — PAS `StatusBadge` du design system (le type de mission
n'est pas un `TrustLevel`, même raisonnement que `SyncStatusIndicator`/`AlertBanner`,
tickets 007/008/010) : « Première inspection » ou « Mission de suivi — Réserve
#<8 premiers caractères de l'UUID> », dérivé de `mission.reserveId` (exposé depuis le
ticket 013). Référence courte de l'UUID plutôt que `Reserve.description` : ce champ
n'est **en pratique jamais renseigné** nulle part dans le code actuel — l'exposer aurait
été trompeur.

**Statut `completed` mal dérivé pour une mission de suivi** : `apps.inspections.services.
list_missions_for_inspector` filtrait `Inspection` par `work_declaration_id`+`inspector`
SEULS, sans borne par mission — une mission de suivi fraîchement affectée, créée APRÈS
qu'une première inspection ait déjà eu lieu sur ce même `work_declaration`, retrouvait
cette ancienne `Inspection` et s'affichait déjà « faite » avant même que l'inspecteur n'y
touche (limite documentée, non résolue, au ticket 013). Corrigé en ajoutant
`created_at__gt=mission.created_at` au filtre — seule une `Inspection` VRAIMENT
postérieure à CETTE mission peut légitimement l'avoir accomplie (aucun champ `reserve` ne
vit sur `InspectionMission` elle-même, doctrine Visible Trust : rien n'est stocké qui
puisse se dériver). Le test bout-en-bout (`test_vertical_slice_mvp1.py`), qui documentait
explicitement cette limite comme acceptée, a été mis à jour pour vérifier le comportement
CORRECT plutôt que de continuer à figer l'ancien bug comme attendu.

**Dropdown de preuves illisible dans BUILD** : le formulaire "Documenter une correction"
affichait chaque preuve comme `{milestone_label} — {date}` seul — plusieurs preuves du
même jalon le même jour apparaissaient identiques, sans moyen de savoir laquelle
sélectionner. Corrigé en ajoutant l'auteur (`Evidence.added_by.email`) au libellé, plus
l'heure en plus de la date. Backend (`apps/build/services.py::_bulk_work_declarations`) :
`.select_related('added_by')` ajouté à la requête déjà groupée — un JOIN, jamais une
requête supplémentaire par preuve, le critère de requêtes BORNÉ du ticket 009
(`TestAllLotsScalesToTwoHundredLots`) reste intact.

**Plugin UI/UX (`ui-ux-pro-max`) consulté, non utilisé** : rien de directement applicable
trouvé au-delà d'un principe d'accessibilité déjà respecté (ne jamais distinguer par la
couleur seule). Les trois corrections restent sur les composants du design system déjà en
place, aucun composant créé hors de `packages/design-system` — `apps/control-pwa`
n'utilise de toute façon ni Tailwind ni shadcn/ui, contrairement à l'hypothèse par défaut
de plusieurs skills de ce plugin.

## Deux races de concurrence dans CONTROL PWA (ticket 015)

Découvertes en documentant/relisant le parcours du ticket 013 — aucune des deux n'est le
bug qu'il corrigeait, mais le même code (`syncEngine.ts`/`InspectionFormView.tsx`) les
rendait possibles. Chacune reproduite par un test déterministe AVANT correction (jamais
un `sleep`), voir `015-races-control-pwa.md` pour le détail complet.

**Cycles de synchro périodiques qui se chevauchent** : `startSyncEngine` déclenche
`runSyncCycle` toutes les 15s sans jamais attendre la fin d'un cycle précédent — un cycle
réseau qui dépasse cet intervalle laissait le sondage suivant resynchroniser le MÊME
brouillon en parallèle, potentiellement avec un instantané périmé. Corrigé par un verrou
PAR BROUILLON (`draftsInFlight`, `Set<string>` module-level) dans `syncDraft` — vérifié et
posé EN TOUT PREMIER, avant tout `await` : deux appels synchrones pour le même
`draft.id` (ex. `Promise.all([syncDraft(draft, a), syncDraft(draft, b)])`) voient donc
TOUJOURS ce verrou déjà posé, aucune fenêtre de course possible pour le vérifier. Jamais
un verrou global : d'autres brouillons continuent de se synchroniser normalement.

**`persist()` concurrents dans `InspectionFormView`** (upload photo vs choix de
décision) : cause DOUBLE, confirmée en reproduisant le bug — 1) état React non atomique
(chaque gestionnaire construisait son "next" à partir du `draft` figé dans SA propre
fermeture de rendu) ET 2) écritures IndexedDB non sérialisées (`saveDraft` remplace
intégralement l'enregistrement, `db.put`, jamais une fusion — rien ne garantissait qu'une
écriture lancée plus TÔT ne se termine pas plus TARD qu'une autre, l'écrasant
silencieusement). Corrigé par `draftRef` (toujours la dernière valeur RÉELLEMENT connue,
mise à jour SYNCHRONE — résout 1) et `persistChainRef` (chaîne de promesses, l'écriture
IndexedDB de chaque `persist` n'est lancée qu'une fois la précédente terminée — résout 2),
plus une comparaison de référence qui ignore le résultat d'une écriture devenue périmée
entre-temps. La mise à jour optimiste (`setDraft`) reste SYNCHRONE, jamais différée
derrière la file d'écriture — le critère « chaque saisie est écrite immédiatement »
(ticket 010, passe 1) reste intact.

**Vérifié aussi manuellement dans un vrai navigateur** (backend + CONTROL PWA en local,
données réelles) : upload d'une vraie photo puis clic immédiat sur une décision sans rien
attendre entre les deux — IndexedDB relu directement confirme les deux changements
présents ; un brouillon reposé à `pending` puis deux évènements `online` déclenchés
dos-à-dos (`window.dispatchEvent`) ne produisent qu'un seul `POST
/api/control/sync/inspection/`, jamais deux, malgré le chevauchement réel des deux
cycles.

## Corrections des deux bugs trouvés au 4ᵉ parcours bout-en-bout (ticket 016)

Trouvés en rejouant le test bout-en-bout du vertical slice MVP 1 une 4ᵉ fois, avec les
scénarios de concurrence du ticket 015 délibérément injectés — voir
`016-corrections-4e-parcours-mvp1.md` pour le détail complet.

**`reserve_id` de mission scopé au LOT plutôt qu'à la mission (ticket 014 bis)** :
`list_missions_for_inspector` dérivait `reserve_id` via `_find_open_reserve_for_lot(lot)`,
scopé au lot entier — une mission déjà `completed`, affectée AVANT qu'une réserve
n'ouvre sur ce même lot (par une autre mission, plus récente), héritait à tort du même
`reserve_id`, affichant « Mission de suivi » côté CONTROL PWA pour une mission déjà
accomplie. Corrigé en bornant temporellement l'attribution — une réserve n'est
« celle de cette mission » que si elle existait DÉJÀ au moment de son affectation
(`reserve.created_at <= mission.created_at`), même principe que `completed` (ticket 014).
Aucun changement frontend : `MissionTypeIndicator` dérivait déjà correctement son
libellé, seule la donnée backend était fausse.

**Lecture périmée traitée après relâchement du verrou (ticket 015 ter)** : le verrou
`draftsInFlight` empêche bien deux `syncDraft` de tourner EN PARALLÈLE sur le même
brouillon, mais pas qu'un second cycle, ayant lu ce brouillon (`getAllDrafts()`) AVANT
que le premier n'ait fini d'écrire son résultat, ne le traite qu'UNE FOIS le verrou du
premier relâché — l'instantané transmis reste alors périmé (une photo déjà synchronisée
y apparaît encore `pending`), provoquant un réupload (Document dupliqué, Evidence
orpheline). Corrigé en relisant l'état RÉEL du brouillon depuis IndexedDB, SOUS le
verrou, avant tout traitement dans `syncDraft` — jamais se fier au paramètre `draft`
seul. Aucune nouvelle fenêtre de course introduite : la relecture se fait après
l'acquisition du verrou, donc à l'abri de toute modification concurrente.

**5ᵉ parcours bout-en-bout manuel** (mêmes 8 étapes, mêmes rôles réels, mêmes scénarios
de concurrence du ticket 015 réinjectés délibérément) : a révélé un TROISIÈME bug, non
couvert par les deux corrections ci-dessus — voir « Bug supplémentaire trouvé PENDANT le
5ᵉ parcours » ci-dessous. Une fois corrigé, le 5ᵉ parcours a été rejoué proprement
(missions neuves, jamais touchées auparavant) et n'a révélé aucun autre bug — MVP1
déclaré clos à l'issue de ce passage corrigé. Voir `016-corrections-4e-parcours-mvp1.md`
pour le détail complet des trois corrections.

### Bug supplémentaire trouvé PENDANT le 5ᵉ parcours : `InspectionFormView` écrase les
### champs pilotés par le moteur de synchro (ticket 016 ter)

En rejouant le 5ᵉ parcours (missions neuves, sans aucune contamination des tentatives
précédentes), le scénario « photo ajoutée après que la décision a déjà été synchronisée
en arrière-plan » a fait réapparaître le même symptôme que ticket 015 ter (réupload
inutile), MALGRÉ ce correctif déjà en place et vérifié unitairement. Cause RÉELLE,
distincte : `InspectionFormView.persist()` fusionne chaque saisie (checklist, photo,
décision, commentaire) sur `draftRef.current` — un état React chargé UNE SEULE FOIS au
montage, jamais resynchronisé avec les écritures que le moteur de synchro fait
directement en IndexedDB en arrière-plan (`syncStatus`, `knownLatestEventId`,
`evidenceId`...). Résultat : la moindre saisie suivante (ex. ajouter une photo APRÈS que
l'inspection a déjà été synchronisée) écrase silencieusement `syncStatus`/
`knownLatestEventId` vers leur valeur d'AVANT synchro, déclenchant une resoumission
inutile de l'inspection — rejetée à tort en conflit (409) par le serveur puisque le
`knownLatestEventId` envoyé est obsolète.

**Corrigé** en relisant l'état RÉEL du brouillon depuis IndexedDB juste avant chaque
écriture réelle (dans la chaîne sérialisée de `persist()`), et en réappliquant la MÊME
mutation sur cette base fraîche plutôt que sur `current`/`next` — même principe déjà
appliqué au moteur de synchro lui-même (ticket 015 ter), désormais aussi côté formulaire.
Chaque fonction `mutate` passée à `persist()` n'opère que sur son paramètre (jamais sur
une fermeture), donc cette réapplication est sûre.

**Test de reproduction** (`InspectionFormView.test.tsx`, nouveau describe block) : crée
un brouillon réel via une vraie saisie, simule une synchro d'arrière-plan complète via
`patchDraft` (la fonction que le moteur utilise réellement, jamais `saveDraft`), puis
ajoute une photo dans le MÊME formulaire resté ouvert — vérifié rouge (`syncStatus`
retombait à `pending`, `knownLatestEventId` à sa valeur d'origine) avant correction, vert
après. Suite complète `InspectionFormView.test.tsx` (11/11) et `syncEngine.test.ts`
(14/14) inchangés par ailleurs.

**Vérifié en conditions réelles** (navigateur, backend réel, pas de contournement API) :
rejoué le scénario exact (décision synchronisée en arrière-plan, puis photo ajoutée,
puis deux événements `online` déclenchés dos-à-dos) sur deux missions neuves — un
brouillon `conforme` et un brouillon `avec_reserve` — sans aucun conflit ni réupload
dans les deux cas. Le flux complet réserve → correction BUILD → mission de suivi
(affichée correctement grâce au ticket 016 bis) → nouvelle inspection `conforme` →
réserve résolue (disparaît de « Réserves ouvertes » côté BUILD) a également été rejoué
de bout en bout sans incident.

## Idempotence de la génération de Task (ticket 017)

Referme le point resté ouvert par `docs/adr/0001-celery-eager-mode.md` depuis avant
l'écriture du ticket 006 : `apps.tasks.services.create_task_for_reserve_opened`/
`create_task_for_mission_assigned` créaient une `Task` sans aucune protection contre une
seconde exécution du générateur (redélivrance broker, rejeu manuel, double `.delay()`
côté appelant) — chaque exécution supplémentaire aurait créé une Task en double,
visible deux fois dans l'inbox de l'utilisateur.

**Corrigé** par une contrainte d'unicité en base sur `Task` (`subject_type, subject_id,
source`) et `apps.tasks.services._get_or_create_task`, qui gère EXPLICITEMENT la course
sous cette contrainte plutôt que de s'appuyer sur un `get_or_create` nu : un `get()`
initial, un `create()` sous `transaction.atomic()`, puis — seulement si `create()` lève
`IntegrityError` — un second `get()` (jamais un retry aveugle) pour récupérer la ligne
que l'autre transaction gagnante vient de créer. Les deux générateurs existants sont
réécrits pour passer par cette fonction commune ; tout futur générateur de Task doit en
faire autant plutôt que d'appeler `Task.objects.create` directement.

**Trois angles de test, chacun prouvant une garantie différente** :
- Double appel séquentiel du service (même connexion) — pas de concurrence réelle, juste
  la logique de relecture.
- **Deux transactions RÉELLEMENT concurrentes** (`TestTaskCreationRaceUnderConcurrency`,
  `django_db(transaction=True)`, deux vrais threads/connexions séparées) : une barrière
  posée sur les deux premiers `Task.objects.get(...)` observés force les deux threads à
  constater « n'existe pas » avant qu'aucun n'écrive — jamais un `sleep` hasardeux, même
  discipline que les tests de race du ticket 015. Confirme qu'un seul thread réussit son
  `create()`, que l'autre rattrape bien l'`IntegrityError` sans la laisser remonter, et
  qu'une seule `Task` existe au final.
- Contre un vrai worker Celery (`real_celery_worker`) : `process_reserve_opened.delay(...)`
  appelée deux fois avec les mêmes arguments — aucun échec, une seule `Task`.

**Piège rencontré en écrivant les tests** : trois fixtures de test préexistantes
(`TestFourTaskTypesAreStructurallyDistinct`, `TestPriorityOrdering`) créaient plusieurs
`Task` de test ancrées sur la MÊME réserve avec le même `source='test_fixture'` — la
nouvelle contrainte les a fait échouer immédiatement (confirmant qu'elle s'applique bien).
Corrigées en variant `source` par tâche de test : ces `Task` synthétiques ne
représentaient jamais le même événement métier rejoué, juste plusieurs éléments de test
distincts ancrés sur un même objet pour vérifier filtrage/tri.

## Chaîne asynchrone non annulée dans `startSyncEngine` (ticket 018)

Premier ticket de la branche `feature/frontend-improvements` (post-MVP1) — dette
repérée mais volontairement laissée de côté au ticket 016 (« sans impact démontré »).
`runIfOnline` (`apps/control-pwa/src/sync/syncEngine.ts`) vérifiait `stopped` avant de
LANCER un cycle, jamais après : si `stop()` était appelé pendant que
`refreshMissions(...)` était encore en vol (composant démonté en plein cycle réseau),
le `.then(() => runSyncCycle(apiClient))` s'exécutait quand même une fois la réponse
arrivée, malgré l'arrêt déjà demandé.

**Corrigé** en revérifiant `stopped` DANS le `.then(...)` lui-même, avant d'appeler
`runSyncCycle` — pas de nouveau mécanisme (`AbortController`...), juste relire la même
source de vérité au bon moment.

**Test de reproduction** (`syncEngine.test.ts`) : un brouillon `pending` seedé (preuve
observable — s'il se synchronise, il déclenche un vrai second appel réseau), `stop()`
appelé alors que le fetch `listMissions` est encore en attente (promesse tenue
manuellement), puis résolu APRÈS. Piège rencontré en l'écrivant : un simple
`await Promise.resolve()` ne suffit pas à laisser la chaîne se dérouler — IndexedDB
(même via le polyfill de test) résout ses requêtes via de vraies tâches de la file
d'attente, pas seulement des microtasks ; corrigé en rendant la main à la boucle
d'événements plusieurs tours réels (`setTimeout(0)` en boucle, jamais une durée
devinée — rien ne concurrence cette chaîne, donc pas de risque de flakiness). Avant
correction : 2 appels réseau observés ; après : 1.

## App Switcher multi-rôle — HOME + BUILD (ticket 019)

Referme le point laissé hors scope au ticket 007 (« App Switcher multi-rôle complet —
dépend de plusieurs rôles réels en usage »), condition remplie depuis la clôture de
MVP 1. Tout ce qu'il fallait existait déjà côté backend, jamais consommé côté
frontend : `GET /api/me/` (ticket 001) renvoie déjà TOUTES les memberships de
l'utilisateur, et `apps.core.middleware.OrganizationScopeMiddleware` accepte déjà un
header `X-Organization-Id` pour choisir l'organisation active (sinon, la membership la
plus ancienne). `AppShell` (ticket 007) avait déjà les props du switcher
(`organizationOptions`/`activeOrganizationId`/`onOrganizationChange`), jamais
alimentées. `userRoles` était un prop codé en dur (`['client']`/`['constructeur']`) —
et comme `main.tsx` rend `<App />` sans prop dans les deux apps, cette valeur par
défaut était la SEULE jamais utilisée en production : le filtrage de modules par rôle
ne reflétait jamais le rôle réel de l'utilisateur connecté.

**Corrigé** en dérivant `activeOrganizationId`/`userRoles`/`organizationOptions` de
`/me`, jamais d'une valeur par défaut : organisation active persistée en localStorage
(`keya_active_organization_id`, même mécanisme que le token), envoyée en header
`X-Organization-Id` sur CHAQUE requête dès qu'elle est connue. Le sélecteur
(`AppShell`) n'apparaît que si l'utilisateur a RÉELLEMENT plusieurs memberships.
`ExceptionsView.tsx::handleAssign` (BUILD) utilisait déjà `getMe()` mais prenait
`memberships[0]` sans jamais laisser choisir — même angle mort, déjà en production,
corrigé en même temps (utilise désormais l'organisation active résolue par `App.tsx`).

**`activeOrganizationId` est dérivé PENDANT LE RENDU, jamais via un `useEffect`
séparé** : un `useEffect` qui recalcule cette valeur après coup (`setState` différé)
cascade sur plusieurs cycles de rendu, suffisant pour rendre `App.test.tsx`
intermittemment flaky (~20 % des exécutions). La valeur persistée sert de valeur
OPTIMISTE tant que `/me` n'a pas répondu ; une fois répondu, la correction (retombée
sur la première membership si la valeur persistée ne correspond à aucune membership
réelle) se fait en UNE SEULE passe de rendu — un `useEffect` séparé ne sert plus qu'à
la PERSISTANCE localStorage, jamais à recalculer la valeur.

**Les vues ne fetchent RÉELLEMENT qu'une fois `/me` résolu** : au tout premier
chargement (rien encore en localStorage), `activeOrganizationId` démarre à `null`
avant que `/me` réponde — sans garde, ça déclenchait un premier appel réseau réel avec
une organisation inconnue, immédiatement suivi d'un second une fois `/me` résolu (un
vrai gaspillage réseau en production, pas seulement un artefact de test). Corrigé en
gatant `getMyLots`/`ExceptionsView`/`AllLotsView` derrière `meState.status ===
'success'`.

**`activeOrganizationId` threading jusque dans les vues « feuilles »** : certaines
vues (`MyActionsView`/`PriorityTaskSummary` côté HOME) appellent leur propre
`getMyTasks()` sans `lotId` pour déclencher un refetch naturel lors d'un changement
d'organisation — `activeOrganizationId` leur est donc transmis en prop explicite,
inclus dans les deps de leur `useApiResource`, pour que le critère « CHAQUE endpoint »
tienne vraiment.

## Écran de connexion — apps/web (ticket 020)

Remplace le mécanisme manuel documenté depuis les tickets 008/009/010
(`localStorage.setItem('keya_access_token', '<jwt>')` posé à la main) par un vrai flux
de connexion. Nouvelle app (`apps/web`, port 5176) — formulaire email/mot de passe,
consomme `POST /api/auth/login/` (ticket 001) puis `GET /api/me/`, redirige vers HOME,
BUILD ou CONTROL selon le RÔLE RÉEL de l'utilisateur (réutilise la dérivation de rôle de
l'App Switcher, ticket 019 : première membership, mapping `inspecteur`→CONTROL,
`constructeur`→BUILD, tout le reste→HOME).

**Vérifié empiriquement, pas supposé** : identifiants invalides, compte désactivé
(`is_active=False`, ticket 011) et email inexistant renvoient EXACTEMENT le même 401
générique côté backend (simplejwt par défaut, volontairement non distinctif) — le
frontend affiche donc un seul message « Identifiants invalides. », jamais un message
différencié qui n'existe pas côté backend.

**HOME/BUILD/CONTROL PWA sont des origines séparées** (ports différents, aucune config
de déploiement partagée dans ce repo) — `localStorage` n'est jamais partagé entre elles.
Les jetons transitent donc par fragment d'URL (`#access_token=...&refresh_token=...`,
jamais en query string) à la redirection ; chaque app réceptrice
(`src/auth/receiveIncomingSession.ts`, dupliqué dans les 3 — pas d'infrastructure
partagée pour un si petit bout de logique, même discipline que la duplication déjà
assumée de `createApiClient` entre apps) le lit une seule fois au démarrage
(`main.tsx`, avant tout le reste), le stocke sous la MÊME clé `keya_access_token` que
le mécanisme manuel qu'il remplace, puis nettoie l'URL.

**Bug réel trouvé en marge, pré-existant depuis le ticket 019** : la toute première
vérification RÉELLE en navigateur du header `X-Organization-Id` (jamais faite au
ticket 019, qui ne s'appuyait que sur des tests à `fetch` mocké) a révélé que
`django-cors-headers` n'autorisait, par défaut, que ses `default_headers` — ce header
personnalisé faisait donc échouer le préflight CORS SILENCIEUSEMENT dès qu'une
organisation active était connue côté frontend (`fetch` lève une erreur réseau
générique, jamais une réponse HTTP lisible — symptôme trompeur en navigateur,
ressemblant à des 503 aléatoires alors que Django ne loggait que des 200). Corrigé
(`config/settings.py::CORS_ALLOW_HEADERS`), avec le port 5176 ajouté à
`CORS_ALLOWED_ORIGINS` (`.env`/`.env.example`).

## Back-office web (ticket 021)

Interface (`apps/web`) pour les trois endpoints livrés côté backend au ticket 011
(recherche utilisateur, consultation organisation/rôle, désactivation de compte) —
jusque-là utilisables uniquement via l'API navigable Django, sans aucun écran.

**`apps/web` cesse d'être SEULEMENT un écran de connexion** (ticket 020) : décision
validée avant implémentation, `admin_keyimmo` gagne sa propre branche dans
`resolveRedirectApp` → `'web'` (auto-référence), plutôt qu'un second écran conditionnel
avant la redirection. `apps/web` devient un point d'arrivée comme HOME/BUILD/CONTROL PWA
— son propre `receiveIncomingSession` (même mécanisme exact, dupliqué comme
`createApiClient` l'est déjà entre apps), `ApiClientContext`, écran post-connexion.
**Ce changement de mapping est documenté explicitement comme une évolution volontaire,
pas un oubli du ticket 020** — voir la note dédiée dans `020-ecran-connexion.md`, section
« Évolution ticket 021 », et le commentaire de `resolveRedirectApp` lui-même
(`apps/web/src/auth/redirectTarget.ts`) : « tout autre rôle → HOME » reste vrai pour
chaque rôle SAUF `admin_keyimmo` désormais, `apps/web` n'avait simplement aucune
destination `web` possible au moment du ticket 020.

**Dérivation de rôle TRANSVERSE, distincte de l'App Switcher** (`apps/web/src/auth/
adminAccess.ts::hasAdminKeyimmoAccess`) : contrairement à `resolveRedirectApp`/l'App
Switcher (ticket 019), qui dérivent le rôle de la PREMIÈRE membership ou de
l'organisation ACTIVE (modules org-scopés BUILD/FINANCE/NOTARY), l'accès au back-office
regarde TOUTES les memberships de l'utilisateur — même raisonnement que `IsAdminKeyimmo`
côté backend (`apps/backoffice/permissions.py`, ticket 011), qui vérifie le rôle dans
N'IMPORTE LAQUELLE des organisations, pas l'organisation active de la requête.
`admin_keyimmo` est une capacité transverse, pas org-scopée — utiliser la première
membership seule aurait refusé l'accès à tort à un admin légitime dont la première
organisation n'est pas KEYIMMO. Le gate applicatif (`AuthenticatedApp` dans `App.tsx`)
s'ajoute à la garde backend, jamais à sa place — même discipline RLS + filtre
applicatif que le reste du projet.

**Désactivation — double confirmation obligatoire, jamais `window.confirm()`**
(`apps/web/src/views/BackofficeView.tsx`) : un premier clic sur « Désactiver ce compte »
n'exécute rien, il affiche seulement un `AlertBanner` + un second bouton dédié
« Confirmer la désactivation » — seul CE second clic appelle `deactivateUser`. Après
succès, l'UI relit l'état réel depuis le backend (`getUserDetail`), jamais une mise à
jour optimiste locale calculée côté frontend (même doctrine « aucun calcul frontend » que
le reste du projet).

**Aucune action ne suggère un raccourci sur un `TrustEvent`** : la garde existante côté
backend (`TestBackofficeNeverExposesATrustEventShortcut`, ticket 011) est complétée côté
frontend par un test qui scanne TOUS les boutons rendus contre une liste de formulations
interdites (`BackofficeView.test.tsx`) — même pattern que le scan de boutons de
`apps/build/src/views/ExceptionsView.test.tsx` (ticket 009, « ne propose JAMAIS de bouton
permettant de changer directement le statut de la réserve »).

**Isolation git — piège d'environnement, pas de ce projet spécifiquement** : le dossier
de travail peut être partagé entre plusieurs sessions concurrentes sans qu'aucun
`git worktree` séparé n'existe par défaut — un `git checkout` d'une session bascule le
HEAD de l'autre (confirmé via `git reflog` en démarrant ce ticket). Résolu en créant un
worktree dédié (`git worktree add`) avant d'écrire du code. À refaire systématiquement
dès qu'une autre session est annoncée comme active sur la même arborescence.

**Bug réel trouvé UNIQUEMENT par vérification navigateur réelle, invisible aux tests
unitaires** (`apps/web/src/auth/redirectTarget.ts::isSameOriginRedirect`,
`App.tsx::defaultRedirect`) : `window.location.assign(url)` ne recharge PAS le document
quand `url` ne diffère de la page courante que par le FRAGMENT (comportement standard
des navigateurs, identique à un lien d'ancre) — exactement le cas d'une redirection
`admin_keyimmo` vers apps/web ELLE-MÊME (même origine, ticket 021). Sans ce correctif,
`receiveIncomingSession()` (`main.tsx`) n'était jamais rejouée après connexion : l'écran
restait bloqué sur le formulaire malgré un token réel dans l'URL. Les tests unitaires ne
pouvaient structurellement pas le détecter : ils injectent toujours un `redirect` mocké
(`AppProps.redirect`), jamais la vraie navigation du navigateur — **leçon générale** :
toute logique qui dépend du comportement RÉEL de `window.location`/navigation doit être
vérifiée en navigateur réel au moins une fois, un mock de `redirect`/`fetch`, aussi
complet soit-il, ne peut pas révéler ce type de bug par construction.

**Outillage `preview_start` — bug d'environnement Windows confirmé, pas un problème de
code** : le lancement déclaratif d'un serveur de dev via `preview_start({name})` (donc
`.claude/launch.json`) échoue systématiquement dans cet environnement dès que le chemin
résolu de l'exécutable contient un espace (`C:\Program Files\...`), y compris avec un
chemin court 8.3 sans espace en `runtimeExecutable` — cinq contournements de
configuration testés, tous infructueux avec une erreur strictement identique.
Contournement RÉEL qui fonctionne : démarrer le serveur manuellement en arrière-plan
puis appeler `preview_start({url: "http://localhost:<port>"})` plutôt que `{name}`.
**Dette explicite à lever avant tout pilote réel** (voir `021-backoffice-web.md`,
section « Vérification »), pas une limite permanente à contourner indéfiniment.

Le backlog MVP 1 vit dans les fichiers `NNN-*.md` à la racine du projet (pas dans un
sous-dossier `tickets/`). Le ticket 001 (fondations auth/organisations/RBAC) est la
dépendance de tous les autres. Respecter le scope explicite de chaque ticket — ne pas
anticiper un ticket suivant dans l'implémentation d'un ticket en cours, même si la
tentation existe (ex : ne pas ajouter de `status` stocké en ticket 001/002 alors que
ticket 003 pose la doctrine append-only).

## Verrouillage de devis / mise en concurrence (ticket 022)

Nouvelle app `apps/procurement` (label `procurement`) — première app dédiée à la mise
en concurrence entre organisations constructeurs candidates sur un `Lot`. Voir
`022-verrouillage-devis-mise-en-concurrence.md` pour le détail complet (décisions de
conception, notes de conception, notes d'implémentation).

**`Devis`, création exclusive par `admin_keyimmo`** — même restriction que
`InspectionMission` (ticket 012) : aucun endpoint d'écriture pour le rôle
constructeur candidat, décision validée avant implémentation. Une ligne `Devis` PAR
couple (lot, organisation candidate) — plusieurs lignes pour un même lot sont
attendues, c'est la mise en concurrence elle-même ; « candidature » et « devis » ne
sont PAS deux tables séparées, fusion volontaire documentée dans le ticket (aucun
consommateur réel, dans ce ticket, d'une candidature sans montant encore connu).

**Aucun montant jamais exposé au rôle constructeur, y compris le sien** — décision de
conception directement dépendante de la précédente (aucun candidat ne soumet lui-même
son montant, donc rien à distinguer). `DevisAdminSerializer` (avec `amount`) et
`DevisCandidateSerializer` (sans, liste `fields` EXPLICITE plutôt qu'une exclusion) ne
sont JAMAIS interchangeables. Garde anti-fuite testée à deux niveaux
(`apps/procurement/tests.py::TestDevisAmountNeverLeaksToConstructeurRole`) : test
direct sur les deux endpoints candidat, et balayage large de tous les autres
endpoints déjà accessibles à ce rôle, complété par un test de la liste EXACTE des
routes GET enregistrées PROJET ENTIER (`get_resolver()`) — même famille que le test
de garde back-office (ticket 011), élargi ici au-delà d'un seul module pour que le
balayage reste une preuve valable dans le temps.

**Statut (`candidat`/`verrouille`) dérivé d'un `TrustEvent`, jamais stocké** — même
doctrine que `Reserve`/`InspectionMission`. Verrouiller (`lock_devis`) empêche toute
nouvelle candidature ou tout second verrouillage sur le même lot (409, pas 400 — même
sémantique que `SyncInspectionView`, ticket 010 : le corps de la requête est valide,
c'est l'ÉTAT du lot qui rend l'opération impossible).

**Bug réel trouvé en écrivant les tests — statut dérivé silencieusement faux juste
après l'écriture qui vient de le poser** : `TrustEvent.organization` vaut toujours
l'organisation du LOT, jamais celle de qui lit. Trois lectures se trouvaient, par
construction, dans le mauvais contexte RLS au moment de dériver le statut : la
réponse de verrouillage elle-même (contexte déjà restauré vers l'admin AVANT
sérialisation), la liste admin, et — le cas le plus grave — un candidat lisant SA
PROPRE candidature (sous `candidate_organization`, jamais `organization`) n'aurait
**structurellement jamais pu voir** qu'il avait gagné un appel d'offres : son statut
restait bloqué à `candidat` pour toujours. Détecté par un test qui échouait dès la
première exécution, pas par relecture. Corrigé en rendant
`apps.procurement.services.get_devis_status(devis, *, restore_organization_id)` sûr
par construction : bascule elle-même vers `devis.organization_id` (toujours connu)
le temps de cette lecture, restaure vers l'organisation RÉELLE de l'appelant (fournie
explicitement, jamais devinée — même discipline que `create_devis`/`lock_devis`).
Les deux serializers reçoivent désormais `context={'request': request}` pour cette
raison précise.

**Piège de test, distinct du bug ci-dessus** : une relecture Django ORM directe
(`Devis.objects.filter(...)`) juste après un appel API admin échoue silencieusement
(résultat vide, jamais une exception) — le contexte RLS de la connexion du PROCESS DE
TEST reste celui où la vue l'a laissé après sa propre restauration, pas celui qu'un
test naïf suppose. Un test ne doit donc jamais revérifier l'état par une requête ORM
non basculée après ce type d'appel — soit la réponse HTTP fait foi seule (même
discipline que `apps.backoffice.tests.py`, ticket 012), soit une bascule RLS
explicite précède la relecture de vérification.

**Isolation git** : implémenté dans un `git worktree` dédié
(`feature/ticket-022-verrouillage-devis`), pas dans le dossier partagé avec l'autre
session active (`feature/frontend-round-2`) — discipline posée au ticket 021, reprise
ici avant d'écrire le moindre code.

## Réconciliation de devis / ajustement (ticket 024)

Voir `024-reconciliation-devis-ajustement.md` pour le détail complet, y compris un
écart de modèle corrigé avant rédaction (le ticket initial supposait `Candidature`/
`AppelOffre`/`DevisLigne`, qui n'existent pas — le ticket 022 a fusionné volontairement
ces notions en un seul `Devis`).

**`Devis.marge_estimee`** (nouveau champ) — saisi par `admin_keyimmo` au même moment
que `amount`, jamais dérivé d'un budget externe (aucun champ budget n'existe sur
`Lot`). **`DevisAjustement`** (nouveau modèle, `apps/procurement`) : un écart de coût
signé sur le devis VERROUILLÉ d'un lot — positif = défavorable (réduit la marge
disponible), négatif = favorable (l'augmente). Marge disponible COURANTE = `marge_estimee`
moins la somme SIGNÉE de tous les ajustements déjà acceptés — jamais une somme de
valeurs absolues. Un écart qui dépasse cette marge (même d'un centime) est refusé
(409), **aucune ligne créée** — `Devis`/`DevisAjustement` déjà créés ne sont eux-mêmes
jamais modifiables après coup (aucune policy RLS `UPDATE`/`DELETE`, comme
`procurement_devis` au ticket 022 — testé avec la même rigueur que l'append-only
`TrustEvent`, ticket 003).

**Bug réel trouvé et corrigé sur du code déjà livré au ticket 022** : le statut
« gagnant » exposé au candidat (`DevisCandidateSerializer.get_status`) était dérivé
IMMÉDIATEMENT au verrouillage (`lock_devis`), sans aucun lien avec une réconciliation
— un candidat pouvait donc voir « gagnant » avant même qu'aucune marge n'ait été
vérifiée. Corrigé par une nouvelle fonction, `get_candidate_visible_devis_status`
(distincte de `get_devis_status`, qui reste inchangée pour l'admin et la logique
interne) : le statut « gagnant » n'est exposé au candidat qu'après AU MOINS un
`DevisAjustement` accepté.

**Deuxième bug réel, de transaction cette fois, trouvé en écrivant `create_ajustement`
lui-même (avant même le premier lancement des tests)** : créer la `Task` d'alerte sur
refus PUIS lever `MarginExceededError` À L'INTÉRIEUR du même `transaction.atomic()`
aurait fait ROLLBACK de la Task en même temps que l'exception se propage — elle aurait
disparu silencieusement malgré un 409 réellement renvoyé. Corrigé en structurant la
fonction en étapes séquentielles distinctes (lecture seule sans `atomic()` propre,
comme `list_devis_for_lot_as_admin` ; écriture de la Task hors de toute portée
annulable, PUIS le `raise` ; écriture de `DevisAjustement` dans son propre bloc
`atomic()` pour le cas accepté).

**Task sur refus assignée à l'acteur courant, pas à un tiers** — différent des deux
générateurs précédents du ticket 006 (`_reserve_opened_label`/`_mission_assigned_label`,
qui notifient toujours quelqu'un D'AUTRE que l'appelant) : `assignee=request.user`
directement, aucun résolveur à écrire. Créée SYNCHRONEMENT (pas de `.delay()` Celery,
contrairement aux deux précédents) — choix explicite et documenté
(`apps.tasks.services.create_task_for_devis_ajustement_refuse`) : le refus a lieu dans
la même requête que la tentative de l'admin, qui reçoit déjà un 409 immédiat.

**Cas limite exact** (critère d'acceptation central du ticket, demandé explicitement) :
écart == marge disponible → accepté, marge résultante == 0 (`Decimal` exact) ; écart ==
marge disponible + 0,01 → refusé. Testé aussi en cumul signé : un écart favorable
accepté PUIS un écart défavorable qui aurait été refusé contre `marge_estimee` seule
doit passer une fois l'économie précédente prise en compte — preuve qu'aucune somme de
valeurs absolues n'est utilisée par erreur.

## Polish visuel — HOME, BUILD, CONTROL PWA, back-office (ticket 023)

Aucune des 4 apps n'avait de feuille de style nulle part dans ce monorepo (uniquement
des styles inline React) — source de la plupart des incohérences visuelles entre
écrans : aucune `font-family` déclarée, `aria-current="page"` posé partout pour
l'accessibilité mais SANS AUCUN traitement visuel associé, couleurs dupliquées en dur
indépendamment (`#E5E7EB`, `#34D399`) dans `AppShell.tsx` et `OverviewView.tsx`, une
même donnée (`progress_percentage`) présentée en barre colorée dans HOME mais en texte
brut dans BUILD.

**`GlobalStyles`** (`packages/design-system/src/components/GlobalStyles`) — reset
minimal (police partagée, `box-sizing`, marges `<body>`, `a`/`button`/`input` sans
chrome navigateur par défaut), monté UNE FOIS par app à sa racine (`main.tsx`), jamais
injecté à l'intérieur d'`AppShell` (qui ne couvre ni l'écran de connexion d'apps/web ni
CONTROL PWA, qui n'utilise pas `AppShell`, voir section CONTROL PWA ci-dessus). Aucun
reset de bordure/padding de bouton en CSS globale — risque de clutter visuel sur des
boutons non individuellement revus, délibérément hors scope de ce ticket.

**`ProgressBar` et `TabBar`, nouveaux composants partagés du design system** — même
principe de source unique déjà appliqué à `AppShell`/`StatusBadge`/`AlertBanner`
(gouvernance ticket 007). `TabBar` remplace deux implémentations `<nav><button
aria-current>` strictement dupliquées entre `apps/home/src/App.tsx` et
`apps/build/src/App.tsx`, sans AUCUN style d'état actif dans les deux cas avant ce
ticket. `ProgressBar` unifie HOME (`OverviewView`, barre déjà existante) et BUILD
(`AllLotsView`, texte brut avant ce ticket) sur un seul composant — même valeur
`progress_percentage` transmise telle quelle, aucun recalcul.

**Nouveaux tokens** (`packages/design-system/src/tokens`) : `typography.fontFamily` ;
`semanticColors.neutral` (border/background/surface/text/textMuted, remplace les
`#E5E7EB` dupliqués) et `semanticColors.progress` (track/fill — `fill` reprend la MÊME
valeur que `TrustLevel.verifie` par coïncidence de goût visuel uniquement, token
SÉPARÉ : une progression de lot n'est pas un `TrustLevel`, même raisonnement que
StatusBadge vs AlertBanner).

**État actif (onglets `TabBar`, module sidebar `AppShell`) distingué par poids de
police + bordure, jamais la couleur seule** — principe d'accessibilité déjà respecté
ailleurs dans ce projet (ticket 014, « ne jamais distinguer par la seule couleur »).
Couleur "ink" neutre (`#111827`), pas une couleur de marque inventée — aucune couleur
de marque n'existe nulle part dans ce projet, en choisir une pour un ticket de polish
aurait été une décision produit, pas de présentation ; choisie aussi pour être
visuellement distincte des 5 teintes `TrustLevel` (gris/bleu/orange/vert/violet).

**Toute erreur de chargement (`role="alert"`) réutilise systématiquement
`AlertBanner`**, plus jamais un `<p role="alert">` brut — règle simple appliquée
uniformément dans les 4 apps, jamais une distinction arbitraire "petite erreur inline"
vs "grande erreur pleine page".

**Extension de périmètre actée avant implémentation** : le périmètre exclusif de cette
branche (`apps/web`, `apps/control-pwa`, `packages/design-system`) a été élargi, avec
accord explicite préalable, à `apps/home` et `apps/build` — strictement des
changements de présentation (styles inline, classNames, imports), jamais de logique
métier ni de calcul. Liste exhaustive des fichiers concernés dans
`023-polish-visuel.md`.

**`SyncStatusIndicator`/`MissionTypeIndicator` (CONTROL PWA) gardent leur statut de
composants LOCAUX** (décision déjà actée tickets 010/014, non remise en cause) — une
pastille colorée y a été ajoutée, teintes délibérément différentes des 5 `TrustLevel`
(dont un rouge, qu'aucun `TrustLevel` n'utilise).

**231 tests frontend, tous verts, zéro régression** — aucun test snapshot introduit
(ce projet n'en a jamais eu la pratique). Vérifié aussi dans un vrai navigateur avec un
vrai backend (compte constructeur réel, redirection réelle vers BUILD) : police
appliquée, état actif des onglets/module sidebar visuellement distinct, liens de
navigation sans soulignement bleu par défaut, zéro erreur console.

## Conventions de code

- Français pour les noms de domaine métier alignés avec les tickets (`Bien`, `Lot`, ...)
  seulement quand le ticket les nomme ainsi côté produit ; les entités techniques citées
  en anglais dans les tickets (`User`, `Organization`, `Membership`, `TrustEvent`,
  `Milestone`) gardent leur nom anglais dans le code pour rester traçables au cahier des
  charges.
- Un critère d'acceptation coché = un test qui le prouve, pas une relecture manuelle.
