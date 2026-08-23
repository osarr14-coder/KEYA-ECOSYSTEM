# F-050 — AppShell responsive mobile (dette F-039)

## Contexte

Dette documentée (jamais corrigée) trouvée pendant la revue critique du
ticket F-039 : `AppShell` ne s'adapte pas du tout à un viewport mobile
(375px) — grille sidebar+contenu fixe (`gridTemplateColumns`, jamais
responsive depuis sa création au ticket 007), débordement horizontal réel,
champ de recherche et CTA principal coupés au bord droit de l'écran. Le
ticket F-039 avait explicitement renvoyé la priorité à « évaluer selon
l'usage réel attendu de HOME (mobile vs desktop) » avant qu'un futur
ticket ne s'y attaque — HOME est l'app CLIENT (lecture de statut de
chantier), un usage mobile réel est plausible, ce ticket ferme le point.

## Diagnostic

`AppShell.tsx` :
- Racine : `gridTemplateColumns: collapsed ? '56px 1fr' : '220px 1fr'` —
  aucune media query, `220px` (ou même `56px`) + contenu peut dépasser un
  viewport à 375px selon le contenu du `<header>`.
- `<header>` : `display: flex` sans `flexWrap` — champ de recherche
  (`<input type="search">`, largeur intrinsèque du navigateur, ~170px+),
  sélecteurs organisation/programme optionnels, lien Task Inbox, avatar :
  tout s'aligne sur une seule ligne, rien ne peut passer à la ligne
  suivante ni rétrécir.

## Décision de conception

**Réutiliser le rail replié existant (56px, icônes seules) comme layout
mobile forcé**, plutôt qu'un nouveau pattern (tiroir hors-écran/hamburger)
— le rail est déjà implémenté, testé, accessible au clavier (ticket 007,
raffiné F-045/F-048). Un nouveau hook `useIsMobile` (`packages/
design-system/src/hooks/`, même famille que `useOnlineStatus`) détecte le
viewport via `window.matchMedia`, piloté par un seuil UNIQUE
`MOBILE_BREAKPOINT_PX` (nouveau token `tokens/breakpoints.ts`) partagé
avec la media query CSS ajoutée à `GlobalStyles`.

`AppShell` dérive `effectiveCollapsed = collapsed || isMobile` et
l'utilise PARTOUT où `collapsed` pilotait déjà le rendu (grille, padding,
alignement, visibilité des libellés) — `gridTemplateColumns` reste donc
piloté en JS (comme avant), jamais un `!important` CSS pour contourner un
style inline. Le bouton replier/déplier est masqué en mobile (rien à
basculer, le rail est permanent en dessous du seuil) — jamais un contrôle
visible sans effet.

Le débordement du `<header>` (recherche/sélecteurs/Task Inbox/avatar), lui,
ne peut PAS se résoudre en JS de la même façon (dimensions intrinsèques du
navigateur) — media query CSS ajoutée à `GlobalStyles` (même précédent que
les pseudo-classes `:hover`/`:focus-visible`, ticket F-038 : "premier écart
du projet vis-à-vis du 100% inline", raison déjà documentée dans ce
fichier) : `flex-wrap: wrap` sur le header + le champ de recherche prend
`width: 100%` en dessous du seuil.

## Scope

- `packages/design-system/src/tokens/breakpoints.ts` (nouveau) —
  `MOBILE_BREAKPOINT_PX`, source unique.
- `packages/design-system/src/hooks/useIsMobile.ts` (nouveau) —
  `window.matchMedia`, dégrade proprement si absent (jsdom en test,
  environnement sans support).
- `AppShell.tsx` — `effectiveCollapsed`, bouton replier/déplier masqué en
  mobile.
- `GlobalStyles.tsx` — media query header (`flex-wrap` + largeur du champ
  de recherche).
- Exports `index.ts` (`useIsMobile`, tokens si pertinent).

## Hors scope

- Tout autre écran/composant que `AppShell`/`GlobalStyles` — pas de
  passage responsive généralisé du reste des vues (tableaux larges,
  formulaires) dans ce ticket, périmètre strictement celui du défaut
  observé (recherche + CTA coupés dans le CHROME, pas le contenu).
- CONTROL PWA — n'utilise pas `AppShell` (voir CLAUDE.md), non concerné.
- Un nouveau pattern de navigation mobile (tiroir/hamburger) — le rail
  existant suffit pour ce ticket, voir décision de conception ci-dessus.

## Critères d'acceptation

- En dessous du seuil mobile, `AppShell` rend TOUJOURS le rail compact
  (56px), quel que soit l'état interne `collapsed` — aucun débordement
  horizontal de la grille.
- Le bouton replier/déplier n'est PAS rendu en dessous du seuil.
- Au-dessus du seuil, comportement strictement inchangé (tous les tests
  `AppShell.test.tsx` existants restent verts SANS modification — `jsdom`
  n'implémente pas `matchMedia`, `useIsMobile` y retourne `false` par
  défaut).
- Le `<header>` passe à la ligne plutôt que de déborder en dessous du
  seuil (vérifié par test de la règle CSS dans `GlobalStyles`, même
  discipline que les tests existants de ce fichier — pas de test
  `@media` par rendu, jsdom ne l'évalue pas).
- Suite `packages/design-system` verte, `tsc --noEmit` propre sur les 4
  apps consommatrices (`AppShellProps` inchangée, aucune régression de
  type).
