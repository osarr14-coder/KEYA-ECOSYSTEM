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

**Explicitement hors scope de cette passe** (passe 2, pas encore construite) : synchronisation
réseau réelle, résolution de conflit, compression photo avant upload, retry avec backoff. Un
item reste en `pending` indéfiniment — attendu et documenté, pas un bug.

## Tickets

Le backlog MVP 1 vit dans les fichiers `NNN-*.md` à la racine du projet (pas dans un
sous-dossier `tickets/`). Le ticket 001 (fondations auth/organisations/RBAC) est la
dépendance de tous les autres. Respecter le scope explicite de chaque ticket — ne pas
anticiper un ticket suivant dans l'implémentation d'un ticket en cours, même si la
tentation existe (ex : ne pas ajouter de `status` stocké en ticket 001/002 alors que
ticket 003 pose la doctrine append-only).

## Conventions de code

- Français pour les noms de domaine métier alignés avec les tickets (`Bien`, `Lot`, ...)
  seulement quand le ticket les nomme ainsi côté produit ; les entités techniques citées
  en anglais dans les tickets (`User`, `Organization`, `Membership`, `TrustEvent`,
  `Milestone`) gardent leur nom anglais dans le code pour rester traçables au cahier des
  charges.
- Un critère d'acceptation coché = un test qui le prouve, pas une relecture manuelle.
