# F-056 — Étendre l'identité de marque complète aux écrans professionnels

## Contexte

Retour utilisateur explicite après F-053/054/055 : la maquette validée
(« KEYA Professional Redesign ») montrait le traitement de marque complet
(bandeau `<header>` en dégradé navy/or) sur HOME et l'écran de connexion —
seuls écrans qu'elle dépeignait. Le ticket F-053 avait délibérément
respecté la doctrine 17.3 existante (« brandColors réservé à HOME,
écrans professionnels priorisent densité/vitesse de scan ») et limité
`AppShell`'s `brand` (bandeau `<header>`) à HOME (ticket F-048).
L'utilisateur demande maintenant explicitement d'étendre ce traitement
complet au back-office et aux écrans professionnels aussi — révision
consciente de cette doctrine, pas un oubli à corriger.

## Scope

- **`apps/build/src/App.tsx`** et **`apps/web/src/App.tsx`** — `brand`
  activé sur `<AppShell>` (était `false` par défaut, jamais passé). Le
  bandeau `<header>` de ces deux apps passe donc en dégradé navy/or avec
  le repère « K+ KEYIMMO AFRIC », identique à HOME.
- **`apps/control-pwa/src/App.tsx`** (`BrandBar`) — n'utilise pas
  `AppShell` (layout tactile dédié, voir CLAUDE.md). Fond passé de
  « bordure basse seule » à `BRAND_GRADIENT` (même dégradé que le bandeau
  `brand` d'AppShell), en encart arrondi plutôt qu'un bandeau plein bord :
  la div racine (`maxWidth`/`minWidth`/`padding`) reste verrouillée par
  `App.test.tsx` (« interface tactile 360-430px »), jamais modifiée pour
  ce ticket.

## Hors scope

- Aucune nouvelle donnée/fonctionnalité — uniquement `style`/props
  visuels, comme F-053/054/055.
- Pas de hero card gradient plein écran sur les écrans de liste/tableau
  (BUILD/apps-web) : la maquette ne dépeignait pas ce type d'écran, et un
  hero pleine page casserait la densité nécessaire à un tableau de
  données — hors scope, à rediscuter si demandé explicitement.

## Critères d'acceptation

- BUILD et apps/web affichent le même bandeau `<header>` en dégradé que
  HOME, clair et sombre.
- CONTROL PWA affiche un bandeau de marque en dégradé, dans les
  contraintes de son layout tactile existant.
- Aucune régression sur les suites de tests existantes.
- Vérifié en Chromium réel (les 4 apps, clair et sombre).
