# F-060 — Câblage du compteur de la cloche AppShell

## Contexte

Demande explicite utilisateur : « Câble le compteur de la cloche AppShell
avec les notifications en attente ». La cloche (`AppShell`, prop
`taskInboxCount`, ticket F-045) existait déjà visuellement dans les 3
apps qui rendent `AppShell` (`apps/home`, `apps/web`, `apps/build`) mais
n'était JAMAIS renseignée par aucune d'entre elles — toujours la valeur
par défaut `0`, constaté dans les captures d'écran déjà envoyées à
l'utilisateur (F-058). L'aria-label du composant (« Task Inbox — N en
attente ») désigne l'inbox `Task` au sens large (les 4 types :
task/notification/alert/exception, ticket 006), pas seulement les
`Task` `type=notification` — le compteur reflète donc TOUTES les tâches
`pending` assignées à l'utilisateur courant, cohérent avec `MyActionsView`
(apps/home), qui affiche déjà les 4 types sans filtre.

## Scope

- **`apps/web/src/api/types.ts`** / **`apps/build/src/api/types.ts`** —
  interface `Task`, copiée à l'identique de `apps/home/src/api/types.ts`
  (même backend, même forme, ticket 006).
- **`apps/web/src/api/client.ts`** / **`apps/build/src/api/client.ts`** —
  `getMyTasks({status?})`, même endpoint déjà consommé par `apps/home`
  (`GET /api/me/tasks/`, ticket 008) — **aucun nouveau endpoint côté
  backend**, ces deux apps n'avaient simplement jamais eu de consommateur
  de cet endpoint jusqu'ici.
- **`apps/home/src/App.tsx`** / **`apps/web/src/App.tsx`** /
  **`apps/build/src/App.tsx`** — `taskInboxCount={... .length}` calculé
  via un nouvel appel `getMyTasks({status: 'pending'})`, dans les deps de
  `activeOrganizationId` (même garde que les autres fetchs de ces 3
  fichiers) : `tasks_task` a une policy RLS mono-organisation, la
  visibilité d'une `Task` change RÉELLEMENT en changeant d'organisation
  active, pas seulement un rafraîchissement de confort.

## Hors scope

- **`apps/control-pwa`** — n'utilise PAS `AppShell` du tout, doctrine
  déjà documentée (`CLAUDE.md`) : layout mobile dense (pas de sidebar/
  topbar desktop), volontairement distinct des 3 autres apps depuis sa
  conception. Aucune cloche à câbler ici — pas une omission, un fait
  architectural déjà en place.
- Aucun clic fonctionnel sur la cloche — son lien reste `href="/tasks"`
  en dur (`AppShell`, ticket F-045), qui ne correspond à AUCUNE route
  dans aucune des 3 apps concernées. Rendre ce lien réellement navigable
  est un chantier séparé (route `/tasks` à créer, ou redirection vers
  l'onglet « Mes actions » existant côté `apps/home` uniquement) — non
  demandé ici, qui ne portait que sur le COMPTEUR.
- Pour `apps/control-pwa`, la note existante dans `apps/tasks/services.py`
  (`create_task_for_mission_assigned`) documente déjà que la `Task`
  `mission_assigned` d'un inspecteur reste invisible via `/api/me/tasks/`
  tant que son organisation active reste la sienne (limitation RLS
  préexistante, non liée à ce ticket).

## Critères d'acceptation

- Les 3 apps (`home`, `web`, `build`) affichent un compteur réel, jamais
  0 par défaut si des tâches `pending` existent pour l'utilisateur/
  l'organisation active.
- Le compteur reflète TOUTES les tâches `pending` (4 types), pas
  seulement les notifications.
- Suites vertes : `apps/home` 80 tests (+2), `apps/web` 203 tests (+2),
  `apps/build` 82 tests (+2). `tsc --noEmit` propre sur les 3 apps.
- Vérifié en direct en Chromium réel (prospect avec notification en
  attente côté HOME, admin_keyimmo côté back-office).
