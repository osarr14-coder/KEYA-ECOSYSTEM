# F-051 — Audit UX/UI et modernisation ciblée (design system)

## Contexte

Audit demandé (posture expert UX/UI + ingénieur frontend senior) de
l'interface de KEYA ECOSYSTEM. Contrairement à un audit générique, l'état
réel du design system s'est révélé déjà solide sur plusieurs axes (tokens
centralisés, composants partagés réellement réutilisés, un seul `<button>`
brut restant dans tout le monorepo, garde-fous de gouvernance automatisés,
accessibilité déjà travaillée — voir le rapport d'audit livré en premier).
Ce ticket couvre les 5 points faibles réels identifiés par cet audit, dans
l'ordre de priorité choisi (risque croissant) :

1. Champ de recherche du header `AppShell` — 100% décoratif, jamais câblé
2. Tableaux sans gestion d'overflow horizontal sur mobile
3. Duplication de structure des formulaires (`label` + champ + `aria-label`)
4. Navigation sidebar strictement plate, aucun regroupement possible
5. Absence de mode sombre

## 1. Recherche décorative retirée

`AppShell`'s `<form role="search">` était rendu INCONDITIONNELLEMENT sur
les 4 apps alors qu'aucune (HOME/BUILD/apps-web) ne fournit jamais
`onSearch` en production (vérifié par grep sur tout le monorepo) — chaque
écran réimplémente sa propre recherche dans le corps de page (Devis,
Programmes, Back-office, Tous les lots). Conditionné à la présence de
`onSearch`, même convention que `organizationOptions.length > 0`.

**Fichiers** : `AppShell.tsx`, `AppShell.test.tsx`.

## 2. Overflow horizontal des tableaux (mobile)

Les 5 vues à `<table>` (voir F-041) débordaient silencieusement sous le
seuil mobile — la PAGE ENTIÈRE scrollait plutôt que le tableau seul (gap
déjà noté hors scope au ticket F-050). **Vérifié en navigateur réel
(Chromium, 375px, script jetable) AVANT d'écrire la règle CSS, pas
seulement raisonné** : `overflow-x: auto` SEUL sur `table` ne fait RIEN
(mesuré : `tableClientW === tableScrollW`, aucun changement) —
`display: block` est nécessaire pour que le tableau devienne sa propre
boîte de défilement. Alignement th/td PRÉSERVÉ malgré `display: block`
(vérifié aussi, th/td width identiques avant/après) : le navigateur génère
une boîte de tableau anonyme autour de `<thead>/<tbody>/<tr>/<th>/<td>`
(CSS2.1 §17.2), l'algorithme de mise en page tableau tourne normalement à
l'intérieur.

**Fichiers** : `GlobalStyles.tsx`, `GlobalStyles.test.tsx`.

## 3. Composant `Field` partagé

Chaque formulaire (Devis, Pricing, Programmes, Paliers légaux) réécrivait
le schéma `<label>{texte}<Input aria-label={MÊME texte} /></label>` — le
libellé visible et `aria-label` peuvent diverger silencieusement (aucun
garde-fou). Nouveau composant `Field` (`packages/design-system/src/
components/Field/`) : dérive `aria-label` du MÊME texte que le libellé
visible (`cloneElement`), centralise l'espacement/la largeur sur le
conteneur. **Migration séquencée** (même précédent que F-038) :
`PricingView.tsx` migré en preuve, les autres formulaires restent
inchangés pour l'instant.

**Fichiers** : `Field.tsx`, `Field.test.tsx`, `PricingView.tsx` (migré),
`index.ts`.

## 4. Regroupement de navigation

`AppModule` gagne un champ optionnel `group` — purement additif (sans lui,
comportement de toutes les apps avant ce ticket, liste plate, aucun
en-tête). Deux modules consécutifs du même `group` sont rendus sous un
en-tête commun ; `AppShell` ne trie/regroupe JAMAIS lui-même, l'ordre du
tableau `modules` reste la seule source d'ordre. **Jamais `aria-hidden`
sur l'en-tête** (contrairement à une première version) : ce texte sert de
repère de section à TOUS les utilisateurs, le retirer de l'arbre
d'accessibilité priverait spécifiquement les lecteurs d'écran du
regroupement introduit pour tout le monde — trouvé en écrivant les tests
(`getAllByRole('listitem')` ne remontait plus l'en-tête), corrigé avant
merge. Masqué en mode replié (rail trop étroit pour du texte). Première
utilisation réelle : `apps/web` (5 onglets) regroupe Devis/Tarifs/Paliers
légaux sous « Ventes & tarification ».

**Fichiers** : `AppShell.tsx`, `AppShell.test.tsx`, `apps/web/src/App.tsx`,
`App.test.tsx`.

## 5. Mode sombre

### Fork architectural découvert et tranché avec l'utilisateur

`semanticColors`/`brandColors` étaient des hex littéraux, avec un test de
gouvernance (`colors.test.ts`) vérifiant explicitement ce format. Un vrai
mode sombre nécessitait soit convertir ces tokens en variables CSS (et
assouplir ce test), soit retoucher individuellement chaque composant —
décision validée explicitement par l'utilisateur : chantier complet, test
adapté au nouveau contrat.

### Mécanisme

- **`semanticColors`** (`tokens/colors.ts`) référence désormais
  `var(--keya-*)`, jamais un hex — **zéro changement requis** dans
  Button/Input/Select/Card/AppShell/StatusBadge/ProgressBar/AlertBanner/
  TabBar (vérifié en navigateur réel, Chromium, AVANT ce changement, que
  `var()` se résout aussi bien en `style={{}}`, en template de chaîne CSS
  shorthand, ET en attribut SVG `fill`/`stroke` — pas seulement en style).
- **`brandColors`** (navy/or) INTOUCHÉ — identité de marque fixe par
  doctrine, jamais dérivée du thème.
- **`GlobalStyles.tsx`** : source UNIQUE des deux palettes. Valeurs
  claires IDENTIQUES aux hex retirés (aucun changement visuel par
  défaut). Valeurs sombres choisies et VÉRIFIÉES (formule de luminance
  relative WCAG, script jetable) : texte 16,3:1/13,35:1, texte atténué
  8,29:1/6,79:1, bordure 2,92:1/2,39:1 — **bordure sombre PLUS contrastée
  que la bordure claire déjà en place** (1,18:1/1,24:1, jamais visée à
  3:1 à l'origine) : aucune régression d'accessibilité par rapport à
  l'existant.
- **Trois états** : `system` (défaut, `@media (prefers-color-scheme:
  dark)`) ou override explicite `[data-theme="dark"/"light"]`, qui gagne
  toujours sur `prefers-color-scheme`.
- **`useTheme.ts`** (hooks/) : lit/persiste la préférence (`localStorage`),
  pose l'attribut `data-theme` sur `<html>`. Dégrade proprement si
  `matchMedia` est absent (jsdom, environnement de test de ce projet).
- **Bascule** : bouton icône lune dans le header `AppShell` (nouvelle
  icône `moon`, tracé vérifié en navigateur réel avant intégration),
  bascule binaire clair/sombre explicite.
- **Anneau de focus** : `rgba(17, 24, 39, 0.12)` (figé) → `rgba(var(
  --keya-focus-ring-rgb), 0.12)` (triplet R,G,B en variable, technique
  vérifiée en navigateur réel) — reste lisible en mode sombre aussi.

### Régression trouvée et corrigée AVANT ce commit (capture d'écran réelle)

Première capture (Chromium, `prefers-color-scheme: dark` émulé) : le
bouton `primary` (`Button.tsx`, fond `neutral.text` + texte `#FFFFFF`
figé) devenait quasi illisible — `neutral.text` s'inverse de teinte entre
thèmes (sombre en clair → clair en sombre), le texte blanc figé restait
donc blanc SUR un fond devenu clair. Corrigé : `color: semanticColors.
neutral.surface` (s'inverse AVEC le fond). Même constat pour `danger`
(fond `danger.border`, calibré pour du texte SUR un fond sombre — pas
pour un remplissage solide) : nouveau token dédié `danger.solid`,
volontairement FIGÉ entre thèmes (même principe que `brandColors`).
**Quatre scénarios revérifiés en navigateur réel après correctif** (clair,
sombre système, sombre manuel, override clair explicite sur OS sombre) —
tous corrects, `[data-theme="light"]` gagne bien sur `prefers-color-scheme:
dark`.

**Fichiers** : `tokens/colors.ts`, `colors.test.ts`, `GlobalStyles.tsx`,
`GlobalStyles.test.tsx`, `hooks/useTheme.ts` (+ test), `Icon/paths.ts`
(icône `moon`), `AppShell.tsx` (+ test), `Button.tsx` (+ test),
`Input.test.tsx`/`Select.test.tsx`/`AlertBanner.test.tsx` (adaptés à une
limite de `jsdom` face à `var()` en shorthand `border`, sans lien avec le
rendu réel du navigateur), `apps/home/src/views/PriorityTaskSummary.test.tsx`.

## Hors scope (assumé, pas oublié)

- Migration des formulaires restants vers `Field` (Devis, Programmes,
  Paliers légaux) — séquencée, comme F-038.
- Regroupement de navigation sur HOME/BUILD (1 à 4 modules, pas assez pour
  le justifier aujourd'hui).
- Un sélecteur de thème à 3 états visible (system/clair/sombre) — la
  bascule actuelle est binaire clair/sombre explicite, `system` reste
  accessible uniquement via `useTheme().setTheme('system')` (pas de
  contrôle UI dédié).

## Critères d'acceptation

- Suite `packages/design-system` : 165 tests, tous verts.
- Suites `apps/home` (64), `apps/build` (77), `apps/web` (189),
  `apps/control-pwa` (73) : aucune régression.
- `tsc --noEmit` et `vite build` propres sur les 5 packages/apps.
- Mode sombre vérifié en navigateur réel (Chromium, captures), pas
  seulement en tests unitaires : système, manuel, override, régression
  de contraste trouvée et corrigée avant commit.
