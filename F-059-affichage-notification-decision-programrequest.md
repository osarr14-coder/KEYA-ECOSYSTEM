# F-059 — Affichage de la notification de décision (`apps/home`)

## Contexte

Suite de B-043 (backend : `Task` `type=notification` créée à la décision).
Un prospect sans bien (son état normal juste après une décision — refusé
pour toujours, ou accepté mais en attente que `admin_keyimmo` crée
effectivement son programme, ticket F-049) atterrit DIRECTEMENT sur
`ProgramRequestView.tsx` (bascule `App.tsx`, ticket F-057) — jamais sur
« Vue d'ensemble »/« Mes actions » (`OverviewView`/`MyActionsView`,
onglets réservés à un utilisateur qui possède déjà un bien). Ces deux
onglets existants restent donc inatteignables pour lui pendant toute la
période qui compte le plus. La notification doit apparaître LÀ où il se
trouve réellement, pas seulement dans un onglet qu'il n'atteindra peut-
être jamais.

## Scope

- **`apps/home/src/views/ProgramRequestView.tsx`** — nouveau composant
  `ProgramRequestNotifications`, affiché en tête d'écran (avant le
  formulaire de soumission). Réutilise `getMyTasks({type: 'notification',
  status: 'pending'})` (`api/client.ts`, déjà utilisé par
  `MyActionsView`/`PriorityTaskSummary`, ticket 008) — **aucun nouveau
  endpoint ni méthode client**. Purement informatif (`<Card icon="bell">`
  + liste), sans bouton « marquer comme lu » — même limite déjà assumée
  par `MyActionsView`, pas une régression. `null` silencieux si aucune
  notification en attente (jamais de carte vide).

## Hors scope

- Aucun changement à `MyActionsView`/`PriorityTaskSummary` — elles
  affichent déjà n'importe quelle `Task`, y compris ce nouveau type,
  sans modification (chevauchement voulu et sans risque pour un sponsor
  qui possède déjà un bien : la même notification peut apparaître aux
  deux endroits, cohérent avec le fonctionnement déjà établi de ces deux
  vues l'une par rapport à l'autre).
- Aucune icône de cloche globale (`AppShell`, prop `taskInboxCount`) —
  composant déjà présent mais non câblé dans TOUTE l'app (`apps/web` ET
  `apps/home`), lien `/tasks` en dur qui ne correspond à aucune route :
  chantier séparé, plus large que cette demande précise, pas traité ici.
- Aucune capacité de marquage lu/non lu — voir B-043 (hors scope
  identique, même raisonnement).

## Critères d'acceptation

- Un prospect avec une notification `pending` la voit dès l'ouverture de
  `ProgramRequestView`, qu'il ait ou non déjà un bien.
- Aucune carte « Notifications » ne s'affiche en l'absence de
  notification en attente.
- Suite `apps/home` verte (78 tests, +2), `tsc --noEmit` propre.
