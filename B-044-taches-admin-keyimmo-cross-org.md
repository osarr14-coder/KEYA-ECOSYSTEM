# B-044 — Visibilité et complétion cross-organisation des tâches `admin_keyimmo`

## Contexte

Découverte en cours de conception de F-062 (bouton « Marquer comme
traité ») : deux générateurs de `Task` (`apps.tasks.services`, tickets
023/B-036) assignent la tâche à `admin_keyimmo`
(`create_task_for_devis_ajustement_refuse`, `create_task_for_lot_ledger_
margin_negative`) mais posent `organization` = celle du devis/grand-livre
CIBLE, jamais celle de KEIMMO — cohérent avec la doctrine « admin_keyimmo
agit par bascule RLS explicite, jamais par appartenance réelle » déjà
établie partout ailleurs dans ce projet (`decide_program_request`,
`update_lot`, `_search_lots_by_name_as_admin`). Conséquence : `TaskViewSet`
étant scopé à l'organisation ACTIVE de l'appelant
(`OrganizationScopedMixin`, comme le reste du projet) et la policy RLS
`tasks_task` étant mono-organisation (aucune branche cross-org
contrairement à `Litige`, ticket B-041), **ces deux types de tâches sont
invisibles ET non complétables pour `admin_keyimmo`** via
`/api/me/tasks/`/`/api/tasks/{id}/complete/` depuis leur création —
demande explicite utilisateur : « corrige le cross-org ».

Décision : réutiliser EXACTEMENT le mécanisme déjà établi et testé pour
ce même problème côté `ProgramRequest` (ticket B-042 :
`list_program_requests_as_admin` — boucle organisation par organisation
avec bascule RLS — et `decide_program_request` — bascule ciblée avec
`organization_id` fourni par l'appelant) — jamais une policy RLS élargie
(piège déjà rencontré et corrigé, voir migration
`0009_lot_admin_keyimmo_select.py`).

## Scope

- **`backend/apps/tasks/serializers.py`** — `TaskSerializer` gagne le
  champ `organization` (lecture seule) : l'appelant (frontend) doit
  connaître l'organisation CIBLE d'une tâche pour pouvoir la compléter
  en cross-org (même besoin que `ProgramRequestSerializer.organization`,
  déjà exposé).
- **`backend/apps/tasks/services.py`** :
  - `list_my_tasks_as_admin(*, admin_user, admin_organization_id,
    status=None)` — boucle toutes les organisations, bascule RLS
    organisation par organisation, filtre `assignee=admin_user` (SES
    propres tâches cross-org, jamais celles d'un autre admin_keyimmo —
    même granularité que `MyTasksView`), restaure le contexte de
    l'admin en `finally`. Pas de plafond `MAX` (même raisonnement que
    `list_program_requests_as_admin` : volume faible).
  - `complete_task_as_admin(*, admin_organization_id,
    target_organization_id, task_id)` — bascule RLS vers l'organisation
    cible, récupère la tâche PAR CETTE organisation, appelle
    `complete_task` existant (aucune duplication de logique), restaure
    le contexte admin.
- **`backend/apps/tasks/views.py`** :
  - `AdminTaskInboxView` (APIView, `GET /api/tasks/admin-inbox/
    ?status=`, `IsAdminKeyimmo`).
  - `AdminTaskCompleteView` (APIView, `POST /api/tasks/{id}/
    admin-complete/?organization_id=<id>`, `IsAdminKeyimmo`) — URL
    DISTINCTE de `tasks/{pk}/complete/` (le piège de collision avec le
    routeur DRF déjà rencontré au ticket B-042 ne s'applique pas ici,
    mais listée par prudence AVANT `router.urls` dans `urlpatterns`,
    même discipline).
- **`backend/apps/procurement/tests.py`** — ajout conscient des 2
  nouvelles routes au test de garde `test_all_registered_get_api_routes_
  match_the_documented_list`.

## Hors scope

- La visibilité de `mission_assigned` (ticket 006, inspecteur) reste
  hors scope — limite de FORME SIMILAIRE mais distincte (l'inspecteur
  n'est jamais membre de l'organisation cible, structurellement, pas
  seulement par choix d'organisation active) ; `apps/control-pwa` n'a de
  toute façon ni `AppShell` ni écran de tâches (F-060/F-061).
- Le frontend (`apps/web`) : ticket séparé F-063, ce ticket ne livre que
  le backend.
- Aucune policy RLS élargie sur `tasks_task` — le mécanisme reste
  entièrement applicatif (boucle + bascule), jamais une règle "admin
  voit tout".

## Critères d'acceptation

- `admin_keyimmo` liste, via `GET /api/tasks/admin-inbox/`, TOUTES ses
  tâches `devis_ajustement_refuse`/`lot_ledger_margin_negative`, quelle
  que soit l'organisation active courante.
- `admin_keyimmo` peut compléter une de ces tâches via `POST /api/tasks/
  {id}/admin-complete/?organization_id=<id>`.
- Un utilisateur non admin_keyimmo reçoit 403 sur les deux nouvelles
  routes.
- Le comportement EXISTANT (`MyTasksView`, `TaskViewSet.complete`, pour
  toute tâche dont l'organisation correspond à l'organisation active de
  l'appelant) reste strictement inchangé.
- Suite backend verte, y compris le test de garde des routes API.
