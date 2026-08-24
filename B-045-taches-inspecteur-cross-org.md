# B-045 — Visibilité et complétion cross-organisation des tâches `mission_assigned`

## Contexte

Suite de B-044 (même limite, rôle différent). Demande explicite
utilisateur : « Corrige aussi la visibilité mission_assigned pour les
inspecteurs ». `create_task_for_mission_assigned` (`apps.tasks.services`,
ticket 012) assigne la `Task` à l'inspecteur (`assignee=mission.
assigned_inspector`) mais pose `organization` = celle de la mission (le
client CIBLE) — l'inspecteur n'en est jamais membre, par construction
(règle d'indépendance, ticket 005). Déjà documenté dans le code au moment
de l'écriture : « `GET /api/me/tasks/` reste scopé par l'organisation
ACTIVE de l'inspecteur… cette Task n'y apparaîtra pas pour lui » — limite
alors consciemment acceptée, corrigée ici sur demande explicite.

## Décision de conception

Deux mécanismes légitimes coexistent déjà dans ce projet pour ce type de
problème (assignee ≠ membre de l'organisation cible) :
- **Boucle + bascule RLS** (B-042 `list_program_requests_as_admin`, B-044
  `list_my_tasks_as_admin`) — aucune policy RLS modifiée.
- **Policy RLS élargie par `assignee`** (`inspections_mission_select`,
  ticket 011 : `organization_id = current_org OR assigned_inspector_id =
  current_user`) — élargissement DÉLIBÉRÉ mais ÉTROIT (jamais « admin/
  rôle X voit tout », seulement « CE user voit SES propres lignes
  assignées »), déjà en production sur `InspectionMission`.

Choix : **boucle + bascule**, pour rester cohérent avec le mécanisme déjà
construit et testé au ticket B-044 sur cette MÊME table (`tasks_task`) —
pas de second mécanisme pour un seul et même problème sur une seule et
même table. La logique de boucle étant strictement identique quel que
soit le rôle appelant (seul le filtre `assignee` change), les fonctions
`services.list_my_tasks_as_admin`/`complete_task_as_admin` (B-044) sont
**généralisées** (renommées, signature élargie) plutôt que dupliquées :
`list_my_tasks_across_organizations`/`complete_task_across_organizations`.
Aucun changement de contrat API pour `apps/web` (F-063) — mêmes URLs,
mêmes noms de route, seul le corps interne change.

## Scope

- **`backend/apps/tasks/services.py`** — renommage `list_my_tasks_as_
  admin`→`list_my_tasks_across_organizations(*, user,
  caller_organization_id, status=None)`, `complete_task_as_admin`→
  `complete_task_across_organizations(*, caller_organization_id,
  target_organization_id, task_id)`. Comportement strictement inchangé
  (même boucle, même bascule, même filtre `assignee=user`).
- **`backend/apps/tasks/views.py`** :
  - `AdminTaskInboxView`/`AdminTaskCompleteView` (B-044) — inchangées
    côté URL/contrat, appellent désormais les fonctions renommées.
  - `InspectorTaskInboxView` (`GET /api/tasks/inspector-inbox/?status=`,
    `IsInspecteur`) / `InspectorTaskCompleteView` (`POST /api/tasks/{id}/
    inspector-complete/?organization_id=<id>`, `IsInspecteur`) —
    nouvelles, même forme exacte que leurs équivalentes admin, mêmes
    fonctions service généralisées. `IsInspecteur` vérifie le rôle dans
    l'organisation ACTIVE de l'appelant (déjà réutilisée cross-org par
    `apps/control/views.py::MissionListView` avec cette même sémantique
    — l'inspecteur reste vérifié « inspecteur quelque part », la boucle
    interne fait le reste, aucune nouvelle classe de permission requise).
- **`backend/apps/tasks/urls.py`** — 2 nouvelles routes, listées AVANT
  `router.urls` (même discipline B-042/B-044).
- **`backend/apps/procurement/tests.py`** — ajout conscient des 2
  nouvelles routes au test de garde.

## Hors scope

- Aucun frontend : `apps/control-pwa` n'a ni `AppShell` ni écran de
  tâches (F-060/F-061, doctrine mobile). Le chemin de visibilité
  opérationnel de la mission pour l'inspecteur reste `GET /api/control/
  missions/` (ticket 012) — cette `Task` demeure une trace secondaire,
  pas la source de vérité produit. Si un futur ticket veut l'exposer
  dans CONTROL PWA, il partira de ce backend déjà corrigé.
- Aucune modification de `inspections_mission_select` (RLS déjà
  correcte, non touchée).
- Aucun changement de contrat pour `apps/web`/B-044 — vérifié par la
  suite de tests existante, qui doit rester verte sans modification.

## Critères d'acceptation

- Un inspecteur liste, via `GET /api/tasks/inspector-inbox/`, ses
  tâches `mission_assigned`, quelle que soit l'organisation active
  courante.
- Un inspecteur peut compléter une de ces tâches via `POST /api/tasks/
  {id}/inspector-complete/?organization_id=<id>`.
- Un utilisateur non inspecteur reçoit 403 sur les deux nouvelles
  routes.
- Le comportement `admin_keyimmo` (B-044/F-063) reste strictement
  inchangé — suite de tests existante verte sans modification.
- Suite backend verte, y compris le test de garde des routes API.
