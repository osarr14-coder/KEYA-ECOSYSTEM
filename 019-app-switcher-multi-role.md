# Ticket 019 — App Switcher multi-rôle (HOME + BUILD)

## Statut
Livré. Deuxième ticket de la branche `feature/frontend-improvements`. Referme le
point laissé hors scope au ticket 007 (« dépend de plusieurs rôles réels en usage » —
condition remplie depuis la clôture de MVP 1).

## Objectif
Un utilisateur avec plusieurs `Membership` (plusieurs organisations, potentiellement des
rôles différents dans chacune) peut voir la liste réelle de ses organisations et
basculer entre elles depuis HOME et BUILD — reflété immédiatement dans les données
affichées ET dans les modules visibles (`AppShell.requiredRoles`).

## Contexte (vérifié dans le code, rien de supposé)
- Backend : `GET /api/me/` (`apps.accounts.views.MeView`, ticket 001) renvoie déjà
  TOUTES les memberships de l'utilisateur (`organization_id`, `organization_name`,
  `role_code`, `role_label`), pas seulement celle de l'organisation active.
- Backend : `OrganizationScopeMiddleware` (`apps/core/middleware.py`) accepte déjà un
  header `X-Organization-Id` pour choisir explicitement l'organisation active de la
  requête ; sans lui, il retombe sur la membership la plus ANCIENNE (`created_at`). Déjà
  testé (`apps/messaging/tests.py`).
- **Aucune app frontend n'envoie jamais ce header.** `AppShell` (ticket 007) a déjà les
  props `organizationOptions`/`activeOrganizationId`/`onOrganizationChange`, jamais
  alimentées par HOME ni BUILD.
- `userRoles` est un prop `AppProps` avec une valeur par défaut codée en dur
  (`['client']` HOME, `['constructeur']` BUILD) — et `main.tsx` rend `<App />` SANS
  prop dans les deux apps : en production, cette valeur par défaut est donc la SEULE
  jamais utilisée. Le filtrage de modules par rôle (`AppModule.requiredRoles`) ne
  reflète aujourd'hui jamais le rôle réel de l'utilisateur connecté.
- BUILD a déjà `getMe()` dans son client API, mais un seul appelant
  (`ExceptionsView.tsx::handleAssign`) l'utilise, et prend `memberships[0]` sans jamais
  laisser choisir — même angle mort que ce ticket corrige, déjà présent en production.
  Sera corrigé en même temps (utilise l'organisation ACTIVE, plus `memberships[0]`).

## Entités touchées
- `apps/home/src/api/client.ts` (+ nouveau `client.test.ts`), `apps/home/src/api/types.ts`
  (ajout `getMe`, header `X-Organization-Id`, type `Me`/`MeMembership` — HOME ne les
  avait pas encore, contrairement à BUILD)
- `apps/build/src/api/client.ts` (+ nouveau `client.test.ts`) — header
  `X-Organization-Id` sur `request()`, `getMe` déjà présent
- `apps/{home,build}/src/main.tsx` (persistance de l'organisation active)
- `apps/{home,build}/src/App.tsx` (dérivation réelle de `userRoles`/
  `organizationOptions`/`activeOrganizationId`, retrait du prop `userRoles` codé en dur,
  garde de chargement le temps que `/me` réponde)
- `apps/home/src/views/{MyActionsView,PriorityTaskSummary,OverviewView}.tsx` — prop
  `activeOrganizationId` ajouté, inclus dans les deps de `useApiResource`
- `apps/build/src/views/ExceptionsView.tsx` (`handleAssign` utilise l'organisation
  active en prop, plus `getMe()`/`memberships[0]` propre à ce composant) et
  `AllLotsView.tsx` (prop `activeOrganizationId` ajouté)
- `apps/{home,build}/src/App.test.tsx` — nouveau describe block App Switcher
- `apps/{home,build}/src/{testUtils.tsx, views/*.test.tsx}` — mise à jour pour le
  nouveau prop requis/mock `getMe` par défaut

## Scope inclus
- `getActiveOrganizationId`/`setActiveOrganizationId` : organisation active persistée en
  `localStorage` (`keya_active_organization_id`), même mécanisme que le token
  (`keya_access_token`) — jamais un état React seul, pour survivre à un rechargement.
- Le client API des deux apps envoie `X-Organization-Id` sur CHAQUE requête dès qu'une
  organisation active est connue — jamais seulement sur certains endpoints.
- Au montage, `App.tsx` (HOME et BUILD) appelle `getMe()` : construit
  `organizationOptions` depuis `memberships`, résout `activeOrganizationId` (valeur
  persistée si elle correspond à une membership réelle, sinon la première membership —
  cohérent avec le défaut déjà appliqué côté backend quand aucun header n'est envoyé),
  et dérive `userRoles = [membership_active.role_code]`. Le prop `userRoles` de
  `AppProps` est retiré (mort en production, jamais utilisé par aucun test).
- Le sélecteur d'organisation n'apparaît que s'il y a RÉELLEMENT plusieurs memberships —
  comportement déjà natif d'`AppShell` (`organizationOptions.length > 0`), il suffit de
  ne peupler la liste que si `memberships.length > 1`.
- `onOrganizationChange` : met à jour l'organisation active (état + localStorage), ce
  qui déclenche un VRAI refetch de toutes les données scopées (lots/tasks pour HOME,
  exceptions/lots pour BUILD) — jamais un rechargement de page complet.
- `ExceptionsView.tsx::handleAssign` (BUILD) : utilise l'organisation active résolue par
  `App.tsx` (passée en contexte/prop), plus `memberships[0]`.

## Ajustements faits en cours d'implémentation (au-delà du scope initial)

**Threading de `activeOrganizationId` dans les vues « feuilles ».** Certaines vues
(`MyActionsView`/`PriorityTaskSummary` côté HOME, aucune vue BUILD indépendante — voir
ci-dessous) appellent leur propre `getMyTasks()`/`getExceptions()` sans `lotId` pour
déclencher un refetch naturel lors d'un changement d'organisation. Pas prévu dans le
scope initial (qui ne mentionnait que « changer la sélection déclenche un nouvel appel
réseau »), mais nécessaire pour que ce critère tienne VRAIMENT sur CHAQUE endpoint —
`activeOrganizationId` est donc désormais un prop explicite de `MyActionsView`,
`PriorityTaskSummary` et `OverviewView` (HOME), ainsi que d'`ExceptionsView` et
`AllLotsView` (BUILD), toujours inclus dans les deps de leur `useApiResource`.

**Dérivation synchrone de `activeOrganizationId`, jamais un `useEffect` séparé.** Le
premier jet utilisait un `useEffect` dédié pour corriger `activeOrganizationId` une fois
`/me` résolu (`setState` différé). Concrètement, ça cascadait sur plusieurs cycles de
rendu (effet → `setState` → nouveau rendu → nouvel effet...), assez pour rendre
`App.test.tsx` intermittemment flaky (~20% des exécutions, `findBy*` n'attrapant pas
toujours l'état stabilisé à temps). Corrigé en dérivant `activeOrganizationId`
ENTIÈREMENT pendant le rendu (valeur persistée comme optimiste tant que `/me` n'a pas
répondu, corrigée en une seule passe dès qu'il répond) — un `useEffect` séparé ne sert
plus qu'à la PERSISTANCE en localStorage, jamais à recalculer la valeur elle-même.

**`getMyLots()`/vues BUILD ne montent qu'une fois `/me` résolu.** Même cause : au tout
premier chargement (aucune organisation encore persistée), `activeOrganizationId`
démarre à `null` avant que `/me` réponde. Sans garde, ça déclenchait un premier appel
réseau réel avec une organisation inconnue, immédiatement suivi d'un second une fois
`/me` résolu — un vrai gaspillage réseau en production, pas seulement un artefact de
test. Corrigé en ne fetchant/montant les vues dépendantes des données qu'une fois
`meState.status === 'success'` (HOME : `getMyLots` ne fait un VRAI appel qu'à ce
moment-là ; BUILD : `ExceptionsView`/`AllLotsView` ne montent pas avant).

## Critères d'acceptation
- [x] `getMe()` existe côté HOME (n'existait pas), déjà présent côté BUILD
- [x] Un utilisateur avec UNE SEULE organisation ne voit jamais de sélecteur — non
      régression explicite sur les deux apps
- [x] Un utilisateur avec PLUSIEURS organisations voit un sélecteur listant chacune, et
      changer la sélection déclenche un nouvel appel réseau avec le header
      `X-Organization-Id` correspondant, sur CHAQUE endpoint appelé ensuite
- [x] Les modules de la sidebar (`FINANCE`/`NOTARY`/`BUILD`) reflètent le RÔLE RÉEL de
      l'organisation active, dérivé de `/me` — jamais un rôle codé en dur
- [x] Changer d'organisation persiste en `localStorage` et survit à un rechargement
- [x] `handleAssign` (BUILD, affectation d'un lot) utilise l'organisation active, plus
      `memberships[0]` en dur
- [x] Suite complète frontend verte (143 tests, 4 workspaces — HOME 34, BUILD 31,
      CONTROL PWA 47 inchangé, design-system 31 inchangé), tests mis à jour pour les
      deux apps ; `tsc --noEmit` propre sur HOME et BUILD

## Explicitement hors scope
- CONTROL PWA — rôle inspecteur fixe par construction (règle d'indépendance, ticket
  005), n'utilise même pas `AppShell` (layout mobile dédié, ticket 010)
- Matrice de permissions fine par organisation (ABAC) — hors scope depuis le ticket 001
- Écran de login réel — toujours hors scope (tickets 008/009), le token reste lu depuis
  `localStorage` en attendant un futur ticket dédié
- Changer d'organisation avec une saisie locale non sauvegardée en cours — ni HOME ni
  BUILD n'ont de brouillon local (contrairement à CONTROL PWA/IndexedDB), rien à
  protéger ici

## Dépendances
Ticket 001 (`GET /me`, `Membership`), ticket 007 (`AppShell`, props du switcher déjà
présentes), ticket 009 (`ExceptionsView`/`getMe` existant côté BUILD).
