# Ticket F-043 — Grille d'espacement modulaire (packages/design-system)

## Statut

**Implémenté, testé, documenté.** Suite `design-system` (103 tests, +3
dédiés), `tsc --noEmit` propre sur les 5 packages. Portée volontairement
limitée au token seul — pas de migration de vue (voir Explicitement hors
scope).

## Origine

Demande de refonte dans l'esprit Josef Müller-Brockmann (discipline
suisse : grille modulaire, chaque espacement dérive d'une unité de base,
jamais un choix arbitraire par vue). Recherche du point de départ le
moins risqué et le plus fondationnel avant toute migration visuelle.

## Inventaire réel (grep `margin`/`padding`/`gap`, 4 apps, avant conception)

| Valeur | Occurrences |
|---|---|
| 8px | 38 |
| 16px | 24 |
| 12px | 22 |
| 4px | 15 |
| 24px | 3 |
| 20px | 3 |
| 6px | 1 — hors grille |
| 2px | 1 — hors grille |

**106 valeurs sur 108 sont déjà des multiples de 4px** — la discipline
existait déjà dans le code, simplement jamais formalisée. L'unité de
base `4px` n'est donc pas un choix esthétique importé, c'est ce que le
code fait déjà sans le nommer. Seules 2 occurrences (`6px` dans
`apps/control-pwa/src/components/StatusDot.tsx`, `2px` dans
`apps/control-pwa/src/views/InspectionFormView.tsx`) sortent de cette
grille implicite — signalées, non modifiées (voir Hors scope).

## Décisions de conception

**A. Six paliers, exactement ceux réellement utilisés** — `xs` 4px,
`sm` 8px, `md` 12px, `lg` 16px, `xl` 20px, `xxl` 24px. Aucune taille
inventée au-delà de l'inventaire (même règle que F-042 pour l'échelle
typographique) : pas de palier `32px`/`48px` bien que ce soit une
progression Müller-Brockmann classique, faute d'usage réel observé
aujourd'hui.

**B. Ticket volontairement scindé de toute migration** — créer
`tokens/spacing.ts` est un geste additif, à risque nul (aucun fichier
consommateur touché). Migrer les dizaines de vues qui ont encore ces
valeurs en dur inline est un chantier bien plus large, hors scope de ce
ticket par décision explicite de l'utilisateur (« crée juste le token
pour l'instant ») — même précédent que F-038 (« migration séquencée du
reste du projet, ordre suggéré, jamais imposée en un seul ticket »).

## Entités touchées

- `packages/design-system/src/tokens/spacing.ts` (nouveau) —
  `SpacingTokens`, `spacing`.
- `packages/design-system/src/tokens/spacing.test.ts` (nouveau) — 3
  tests (paliers exacts, chaque valeur multiple de 4px, ordre strictement
  croissant).
- `packages/design-system/src/index.ts` — export de `spacing`,
  `SpacingTokens`.

## Scope inclus

- Token `spacing` seul, testé, exporté.

## Explicitement hors scope

- **Migration des vues** — aucun fichier consommateur touché ; les
  valeurs en dur (`'8px'`, `'16px'`, etc.) restent telles quelles dans
  les 4 apps jusqu'à un futur ticket.
- **Normalisation des 2 valeurs hors grille** (`6px`, `2px`) — leur
  contexte visuel n'a pas été vérifié, aucune modification tentée sans
  cette vérification.
- **Paliers au-delà de 24px** (`32px`, etc.) — aucun usage réel observé,
  rien à formaliser.
- **Grille de colonnes visible** (mise en page en colonnes façon
  affiche suisse) — un changement de layout, pas d'espacement ; hors
  scope, nécessiterait son propre ticket vérifié séparément.
- **Identité de marque HOME** (navy/or) — doctrine déjà tranchée
  (ticket F-039), non rouverte par cette demande.

## Critères d'acceptation

- [x] Inventaire réel (`grep`) effectué avant toute valeur choisie.
- [x] Six paliers, tous multiples exacts de l'unité de base 4px, tous
      réellement observés dans le code existant.
- [x] Paliers strictement croissants (test dédié).
- [x] Aucun fichier de vue modifié — purement additif.
- [x] Suite `design-system` verte (103 tests), `tsc --noEmit` propre sur
      les 5 packages.
- [x] Documentation (ce fichier).

## Suivi suggéré (non imposé)

Migration séquencée possible, dans cet ordre suggéré (comme F-038 pour
Button/Input/Select) — un fichier à la fois, vérifié en navigateur réel
avant de passer au suivant, même discipline que F-041 :
1. Les 5 vues déjà touchées par F-041 (tableaux) — déjà dans un état
   récemment vérifié, risque de régression le plus faible.
2. `AppShell`/`GlobalStyles` eux-mêmes, si un espacement structurel y
   est encore en dur.
3. Le reste des vues, app par app.

Normalisation de `StatusDot` (6px→8px ou 4px ?) et
`InspectionFormView` (2px→4px ?) à traiter séparément, avec vérification
visuelle dédiée (contexte tactile CONTROL PWA, cible d'interaction
44×44 à ne pas perturber).
