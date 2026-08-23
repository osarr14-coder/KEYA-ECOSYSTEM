# F-054 — Refonte visuelle professionnelle : BUILD et CONTROL PWA

## Contexte

Suite du ticket F-053 (refonte visuelle professionnelle) : BUILD hérite déjà
automatiquement de la plupart des changements F-053 via les composants
partagés (`AppShell` — sidebar en dégradé, `Button`/`Card` — ombres). CONTROL
PWA, en revanche, **n'utilise pas `AppShell`** (layout tactile dédié 360-430px,
voir CLAUDE.md section CONTROL PWA) — aucun changement F-053 ne l'atteint
automatiquement, il n'avait même aucun repère de marque avant ce ticket.

## Scope

- **CONTROL PWA (`apps/control-pwa`)** :
  - `App.tsx` — nouveau `BrandBar` (badge K+ dégradé + « KEYA » + label
    « CONTROL »), enfant ajouté à la div racine EXISTANTE (jamais un nouveau
    wrapper autour d'elle — `App.test.tsx`, « interface tactile 360-430px »,
    cherche le plus proche ancêtre `<div>` du texte « Mes missions » et
    vérifie `maxWidth`/`minWidth` dessus ; un div intermédiaire aurait cassé
    ce test).
  - `InspectionFormView.tsx` (`FIELDSET_STYLE`) et `MissionsListView.tsx`
    (carte de mission cliquable) — ombre `--keya-shadow-sm` + rayon 8px→14px,
    même traitement que `Card` (packages/design-system).
- **BUILD (`apps/build`)** :
  - `ExceptionsView.tsx` (`ROW_STYLE`, les 4 types de ligne d'exception) —
    même traitement (ombre + rayon 14px). `AllLotsView.tsx` non touché :
    strictement un tableau (déjà couvert par les règles `table`/`th`/`td` de
    `GlobalStyles`), pas un conteneur candidat à ce traitement.

## Hors scope

- Aucun changement de structure/logique — uniquement `style`/tokens visuels,
  comme F-053.
- `AllLotsView.tsx` (BUILD) — voir ci-dessus, pas concerné.

## Critères d'acceptation

- CONTROL PWA affiche un repère de marque cohérent avec les 3 autres apps.
- Aucune régression sur `App.test.tsx` (« interface tactile 360-430px » en
  particulier) ni sur le reste des suites CONTROL PWA/BUILD.
- Vérifié en Chromium réel (mobile 390px, clair et sombre).
