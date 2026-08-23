# F-062 — Bouton « Marquer comme traité » sur les tâches

## Contexte

Suite de F-061 (écrans « Mes actions »/« Tâches » alimentés par `GET
/api/me/tasks/`). Demande explicite utilisateur : « Ajoute un bouton
"marquer comme traité" sur ces tâches ». Le backend possède déjà
`POST /api/tasks/{id}/complete/` (`TaskViewSet.complete`, ticket 006) —
jamais consommé par aucune app frontend jusqu'ici. Aucun changement
backend nécessaire : câblage frontend pur.

## Découverte en cours de conception — limite préexistante, non corrigée

`TaskViewSet` est scopé à l'organisation ACTIVE de l'appelant
(`OrganizationScopedMixin`), comme le reste du projet. Deux générateurs de
`Task` (`devis_ajustement_refuse`/`lot_ledger_margin_negative`, tickets
023/B-036) assignent la tâche à `admin_keyimmo` mais posent
`organization` = celle du devis/grand-livre CIBLE, jamais celle de
KEIMMO — cohérent avec la doctrine « admin_keyimmo agit par bascule RLS
explicite, jamais par appartenance réelle » déjà établie partout ailleurs
(`decide_program_request`, `update_lot`, etc.). Conséquence concrète :
**ces deux types de tâches sont déjà invisibles ET non complétables**
pour `admin_keyimmo` via `/api/me/tasks/`/`/api/tasks/{id}/complete/`
depuis leur création — la policy RLS `tasks_task` (mono-organisation,
aucune branche cross-org contrairement à `Litige`, B-041) filtre la ligne
avant même que l'application ne la voie. Vérifié via les tests
existants (`apps/procurement/tests.py`), qui doivent déjà basculer
explicitement le contexte RLS vers l'organisation cible pour lire ces
lignes en test.

**Ce ticket ne corrige PAS cette limite** (pas dans la demande, chantier
cross-org à part entière — même ampleur que B-042's `list_program_
requests_as_admin`) : signalé à l'utilisateur, documenté dans le code
(`apps/web/src/views/TasksView.tsx`), pas laissé silencieux.

## Scope

- **`apps/home/src/api/client.ts`** / **`apps/web/src/api/client.ts`** /
  **`apps/build/src/api/client.ts`** — `completeTask(taskId)`.
- **`apps/home/src/views/MyActionsView.tsx`** — bouton visible
  uniquement pour une tâche `status==='pending'` (cette vue n'a jamais
  filtré par statut, une tâche `done` reste affichée, simplement sans
  bouton après un refetch).
- **`apps/web/src/views/TasksView.tsx`** / **`apps/build/src/views/
  TasksView.tsx`** — même bouton ; ces deux vues filtrent déjà
  `status=pending` (ticket F-061), une tâche complétée disparaît donc de
  la liste au refetch.
- Erreur locale (`AlertBanner`) en cas d'échec du marquage, jamais
  silencieux.

## Hors scope

- La limite cross-org `admin_keyimmo` documentée ci-dessus.
- Aucun bouton pour ANNULER un marquage (« done » → « pending ») — pas
  demandé, et `apps.tasks.services.complete_task` ne prévoit pas ce
  sens inverse.

## Critères d'acceptation

- Une tâche `pending` affiche « Marquer comme traité » dans les 3 vues
  concernées ; une tâche déjà `done` n'affiche aucun bouton.
- Cliquer le bouton appelle `POST /api/tasks/{id}/complete/` puis
  recharge la liste.
- Un échec affiche une erreur locale, sans navigation ni perte d'état.
- Suites vertes : `apps/home` 85 tests (+4), `apps/web` 210 tests (+2),
  `apps/build` 89 tests (+2). `tsc --noEmit` propre sur les 3 apps.
- Vérifié en Chromium réel, bout en bout : soumission → décision admin
  → notification visible avec bouton → clic → tâche marquée `done`
  (`completed_at` renseigné, confirmé via l'API), bouton disparu.
