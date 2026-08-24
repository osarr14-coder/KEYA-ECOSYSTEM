# F-063 — Écran « Tâches » (apps/web) : bascule sur l'inbox cross-org admin

## Contexte

Suite de B-044 (backend). `apps/web` est réservée à `admin_keyimmo` — TOUT
utilisateur qui atteint `TasksView.tsx`/le compteur `taskInboxCount`
(tickets F-060/F-061/F-062) est donc structurellement `admin_keyimmo`.
Or `GET /api/me/tasks/` (utilisé jusqu'ici) ne retourne JAMAIS les tâches
`devis_ajustement_refuse`/`lot_ledger_margin_negative` (organisation
CIBLE, jamais celle de KEIMMO — voir B-044). Remplace donc entièrement
`getMyTasks`/`completeTask` par les deux nouvelles routes admin,
**uniquement dans `apps/web`** : `apps/home`/`apps/build` gardent
`GET /api/me/tasks/` inchangé (leurs tâches ont déjà l'organisation du
viewer, aucun problème à corriger là).

## Scope

- **`apps/web/src/api/types.ts`** — `Task` gagne le champ `organization`
  (miroir de `TaskSerializer`, B-044) : nécessaire pour transmettre
  `organization_id` à `admin-complete`.
- **`apps/web/src/api/client.ts`** :
  - `getMyTasks` → `getAdminTasks(status?)`, `GET /api/tasks/admin-inbox/`.
  - `completeTask(taskId)` → `completeAdminTask(taskId, organization)`,
    `POST /api/tasks/{id}/admin-complete/?organization_id=<id>`.
- **`apps/web/src/App.tsx`** — `taskInboxCount` utilise `getAdminTasks`.
- **`apps/web/src/views/TasksView.tsx`** — utilise `getAdminTasks`/
  `completeAdminTask(task.id, task.organization)`.

## Hors scope

- `apps/home`/`apps/build` — inchangées (voir Contexte).
- La limite `mission_assigned`/CONTROL PWA (hors scope de B-044 aussi).

## Critères d'acceptation

- Le compteur de la cloche et `TasksView` (apps/web) reflètent
  désormais les tâches `devis_ajustement_refuse`/`lot_ledger_margin_
  negative` quelle que soit l'organisation active de l'admin.
- Le bouton « Marquer comme traité » fonctionne pour ces tâches.
- Suite `apps/web` verte, `tsc --noEmit` propre.
- Vérifié en Chromium réel avec une tâche cross-org réelle créée en
  base (aucun générateur de production n'en produit encore côté données
  de démo).
