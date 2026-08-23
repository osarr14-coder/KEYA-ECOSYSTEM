# F-061 — Cloche AppShell cliquable vers /tasks

## Contexte

Suite de F-060 (compteur câblé). Demande explicite utilisateur : « Rends
le lien de la cloche cliquable vers /tasks ». La cloche restait un lien
mort (`<a href="/tasks">`, ticket F-045) : aucune des 3 apps qui rendent
`AppShell` n'avait de vraie route `/tasks` — `apps/home`/`apps/build`
n'ont aucun routeur (état de tabs en `useState` simple), `apps/web` a un
vrai routeur (`useUrlSyncedTab`) mais sans ce chemin dans `TAB_ROUTES`. Un
`<a href>` classique aurait donc soit rechargé la page en pure perte
(home/build, aucune route à intercepter), soit fait un rechargement
complet évitable (web).

## Scope

- **`packages/design-system/AppShell.tsx`** — nouvelle prop optionnelle
  `onTaskInboxClick?: () => void`. Fournie : le clic appelle
  `event.preventDefault()` puis le handler (navigation SPA, décidée par
  l'appelant). Absente : comportement `href="/tasks"` d'origine inchangé
  (rétrocompatible).
- **`apps/home/src/App.tsx`** — `onTaskInboxClick={() => setActiveTab('actions')}`,
  bascule vers l'onglet « Mes actions » déjà existant (`MyActionsView`,
  ticket 008), même destination que le bouton « Voir toutes mes actions »
  de `PriorityTaskSummary` — aucun second écran de tâches recodé. Limite
  connue et acceptée : un sponsor SANS bien n'a pas cet onglet, mais sa
  seule notification possible à ce stade est déjà affichée directement
  sur `ProgramRequestView` (ticket F-059) — la cloche n'est pas son seul
  chemin d'accès dans ce cas.
- **`apps/web/src/views/TasksView.tsx`** / **`apps/build/src/views/
  TasksView.tsx`** (nouveaux, quasi identiques) — liste en lecture seule
  des tâches `pending` (`GET /api/me/tasks/?status=pending`, même
  endpoint que le compteur F-060), aucun bouton « traiter » (même
  limite déjà assumée que `MyActionsView`, apps/home). Ajoutés comme
  onglet réel et visible : « Tâches » dans `TAB_DEFINITIONS` (apps/web,
  URL `/tasks`) et dans `TABS` (apps/build, pas de routeur ici).

## Hors scope

- `apps/control-pwa` — toujours exclue (n'utilise pas `AppShell`, F-060).
- Aucun filtre/tri avancé sur `TasksView` — liste simple, même esprit que
  `MyActionsView` (apps/home).
- Aucune capacité de marquer une tâche traitée depuis ces nouveaux
  écrans — `TaskViewSet.complete` (`POST /api/tasks/{id}/complete/`)
  existe déjà côté backend mais n'est appelé nulle part côté frontend à
  ce jour ; l'ajouter est un chantier séparé, pas demandé ici.

## Critères d'acceptation

- Cliquer la cloche dans `apps/home` bascule sur « Mes actions », jamais
  de rechargement de page.
- Cliquer la cloche dans `apps/web` bascule sur « Tâches » ET met à jour
  l'URL (`/tasks`), navigable directement aussi (lien direct, `useUrlSyncedTab`).
- Cliquer la cloche dans `apps/build` bascule sur « Tâches ».
- Sans `onTaskInboxClick` fourni (rétrocompatibilité), la cloche garde
  son `href="/tasks"` d'origine.
- Suites vertes : `design-system` 167 tests (+2), `apps/home` 81 tests
  (+1), `apps/web` 208 tests (+5), `apps/build` 87 tests (+5).
  `tsc --noEmit` propre sur les 4 packages touchés.
