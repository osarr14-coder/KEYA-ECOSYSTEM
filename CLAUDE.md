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
    core/             # middleware RLS, viewsets/mixins réutilisables, utilitaires partagés
  config/             # settings.py, settings_test.py, urls.py, wsgi/asgi
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
rôle admin applicatif. Deux couches, pas une seule :

1. **Aucune policy RLS UPDATE/DELETE n'est définie** sur la table — PostgreSQL applique
   alors un déni par défaut pour ces commandes (aucune ligne visible/ciblable), même pour
   le propriétaire de la table via `FORCE ROW LEVEL SECURITY`. Une tentative d'UPDATE/
   DELETE affecte silencieusement 0 ligne, sans lever d'exception : un test doit donc
   vérifier l'invariant (`cursor.rowcount == 0` + donnée inchangée après
   `refresh_from_db()`), pas s'attendre à une erreur.
2. **Un trigger `BEFORE UPDATE/DELETE`** (migration `0002_append_only`) lève une exception
   inconditionnellement. Il est actuellement « silencieux » en usage normal (la couche 1
   bloque avant qu'il n'ait à s'exécuter), mais c'est le filet de sécurité qui continuerait
   à bloquer si une policy RLS UPDATE/DELETE était ajoutée par erreur dans une migration
   future — d'où un test dédié qui garde son existence via `pg_trigger`
   (`apps/trust/tests.py::TestAppendOnly::test_append_only_trigger_exists_in_the_database`).

Toute correction d'un événement est un nouvel appel à `repository.create(..., previous_event=...)`,
jamais une modification. Le module `apps/trust/repository.py` n'expose et ne doit jamais
exposer de fonction `update`/`delete` — c'est vérifié par un test (`hasattr`).

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
