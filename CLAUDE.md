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
    core/             # middleware RLS, viewsets/mixins réutilisables, utilitaires partagés
  config/             # settings.py, settings_test.py, urls.py, wsgi/asgi
  conftest.py         # fixtures de test partagées entre apps (ex : real_celery_worker)
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
