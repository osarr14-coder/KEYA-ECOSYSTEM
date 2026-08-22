# B-039 — KEYIMMO gatekeeper de l'introduction des programmes immobiliers

## Contexte

Suite à un audit (session du 2026-08-22) : `ProgramViewSet`
(`backend/apps/programs/views.py`) n'a aujourd'hui aucune restriction de
rôle — `IsAuthenticated` seul, via `OrganizationScopedMixin`. N'importe
quel membre d'une organisation peut créer, renommer ou supprimer un
`Program`, alors que `ProgramCost` et `LotLedger` (même domaine, objets
fondateurs de la donnée économique du programme) sont déjà verrouillés à
`admin_keyimmo`.

## Décisions validées

1. **Périmètre** : `Program` + `Asset` + `Lot` ensemble, pas seulement
   `Program` — même faille aux trois niveaux (`AssetViewSet`/
   `LotViewSet` utilisent le même mixin, aucune restriction non plus),
   à fermer partout.
2. **CRUD complet** : `create`/`update`/`partial_update`/`destroy`
   verrouillés à `admin_keyimmo` sur les trois ViewSets, pas seulement
   `create`. Lecture (`list`/`retrieve`/`hierarchy`) reste ouverte aux
   membres de l'organisation concernée — mode consultation, comportement
   actuel inchangé.
3. **Hors scope : aucun écran frontend.** Ce ticket couvre uniquement le
   verrou API (le risque réel et immédiat). Un écran de création côté
   `apps/web` (seule app où siège déjà le back-office `admin_keyimmo`)
   sera un ticket frontend séparé, cadré une fois ce correctif fusionné.

## Constat d'audit — un point d'architecture à trancher avant le code

Ajouter `IsAdminKeyimmo` aux `permission_classes` des trois ViewSets ne
suffit **pas seul** à rendre la fonctionnalité utilisable, à cause d'un
mécanisme déjà en place :

- `OrganizationScopedMixin.perform_create` pose
  `organization=request.organization`.
- `request.organization` est résolu par
  `OrganizationScopeMiddleware._resolve_organization`, qui ne regarde
  QUE les `Membership` de l'utilisateur **qui fait la requête** — jamais
  un `organization_id` passé en paramètre.
- `AssetSerializer`/`LotSerializer` répliquent la même restriction au
  niveau du champ (`self.fields['program'].queryset` / `['asset']`
  filtrés sur `request.organization`).
- Or `IsAdminKeyimmo` est documentée (`apps/backoffice/permissions.py`)
  comme une capacité **transverse à toutes les organisations**,
  précisément pour ne PAS dépendre d'un `Membership` dans chacune
  d'elles. Si un `admin_keyimmo` n'est pas lui-même membre de
  l'organisation promoteur pour laquelle il crée le programme (le cas
  normal), `request.organization` sera `None` ou ne contiendra pas la
  bonne organisation — la création échouera malgré la permission
  accordée.

Deux options, à trancher avant l'implémentation :

- **Option A** — exiger qu'un `admin_keyimmo` détienne un `Membership`
  explicite dans chaque organisation promoteur qu'il gère. Aucun
  changement de mécanisme, mais contredit la doctrine documentée
  d'`IsAdminKeyimmo` (capacité transverse) et crée une charge
  opérationnelle croissante (un `Membership` à créer à chaque nouvelle
  organisation × chaque admin).
- **Option B (recommandée)** — aligner `Program`/`Asset`/`Lot` sur le
  pattern déjà utilisé dans ce même fichier pour `ProgramCost` et
  `LotLedger` (`ProgramCostCreateSerializer`,
  `LotLedgerCreateSerializer`) : pour un `admin_keyimmo`, l'organisation
  cible (et le `program`/`asset` parent) est un **champ explicite du
  payload**, pas dérivée de `request.organization`. La lecture, elle,
  reste scopée à l'organisation active du membre consultant — comportement
  inchangé. Cette option ne nécessite pas de créer un mécanisme nouveau
  : c'est le pattern déjà en place et déjà éprouvé pour deux objets du
  même domaine.

Je recommande B pour sa cohérence avec l'existant, mais je ne tranche
pas seul — confirme avant que je code, ce point dépasse un simple ajout
de `permission_classes` et change la forme du payload de création.

## Scope

- Backend uniquement : `apps/programs/views.py`,
  `apps/programs/serializers.py`, `apps/programs/urls.py` si nécessaire.
- `ProgramViewSet`, `AssetViewSet`, `LotViewSet` : lecture ouverte aux
  membres de l'organisation active (consultation, inchangé) ; écriture
  (`create`/`update`/`partial_update`/`destroy`) réservée à
  `admin_keyimmo`.
- Si Option B confirmée : reprise du pattern « organisation/program/asset
  explicite en payload pour `admin_keyimmo` », symétrique à
  `ProgramCostCreateSerializer`/`LotLedgerCreateSerializer`.
- Mise à jour des tests existants dans `apps/programs/tests.py` : 37
  appels aux helpers `_create_program`/`_create_asset`/`_create_lot`
  avec des clients non-admin (recensés à l'audit) — une bonne partie
  teste explicitement le comportement self-service qu'on retire. À
  adapter (vérifier un 403 pour un non-admin, ou une création réussie
  par un `admin_keyimmo`), en préservant l'intention RLS/isolation
  d'organisation de ces tests — pas à les supprimer.

## Hors scope

- Tout écran frontend (création UI = ticket séparé, voir Décision 3).
- `LotViewSet.assign_organization` (déjà un endpoint dédié) : à vérifier
  à l'implémentation si la nouvelle permission générique l'affecte
  aussi, sans étendre son comportement par surprise si ce n'est pas le
  cas aujourd'hui.
- Toute autre app (`procurement`, `pricing`, etc.) — seul
  `apps/programs` est concerné par ce ticket.

## Critères d'acceptation

- Un utilisateur non `admin_keyimmo` (membre d'une organisation) reçoit
  403 sur `POST`/`PATCH`/`PUT`/`DELETE` vers `/api/programs/`,
  `/api/assets/`, `/api/lots/`.
- Un utilisateur non `admin_keyimmo` continue de **lire**
  (`list`/`retrieve`/`hierarchy`) les programmes/assets/lots de son
  organisation active, sans changement de comportement.
- Un `admin_keyimmo` peut créer un `Program`/`Asset`/`Lot` pour une
  organisation dont il n'est **pas** membre — test explicite couvrant
  ce cas précis, le point central du ticket.
- Suite `apps/programs/tests.py` verte, avec les 37 appels aux helpers
  de création adaptés (pas supprimés) pour refléter le nouveau contrat.
- Aucune régression sur `ProgramCost`/`LotLedger` (déjà gatés
  `admin_keyimmo` ailleurs, non touchés par ce ticket).
