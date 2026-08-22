# Ticket F-044 — Migration Button/Input/Select sur toutes les vues restantes

## Statut

**Implémenté, testé, documenté.** 11 fichiers migrés sur 4 apps. Suite
complète des 5 packages verte (design-system 103, home 58, build 77,
web 180, control-pwa 73 — 491 tests), `tsc --noEmit` propre sur les 4
apps touchées. Zéro régression.

## Origine

Suite directe de la roadmap posée par le ticket F-038 (« Prochaines
étapes », section dédiée) : `Button`/`Input`/`Select` n'avaient été
consommés que par `BackofficeView` (`apps/web`), décision de portée
explicite à l'époque — le reste du projet (4 apps) continuait
d'utiliser des `<button>`/`<input>`/`<select>` bruts. Demande explicite
de l'utilisateur : migrer maintenant l'intégralité du reste, en une
seule passe plutôt que la séquence suggérée par F-038.

## Ordre suivi (roadmap F-038, respecté)

1. `apps/web` (reste) — `App.tsx` (LoginView), `CountryPackSelector.tsx`,
   `DevisView.tsx`, `LegalPaymentTiersView.tsx`, `LotLedgerPanel.tsx`,
   `PricingView.tsx`.
2. `apps/home` — `App.tsx` (sélecteur de bien), `OverviewView.tsx`.
3. `apps/build` — `AllLotsView.tsx`, `ExceptionsView.tsx`.
4. `apps/control-pwa` — `InspectionFormView.tsx`, `MissionsListView.tsx`
   (cas particulier, voir section dédiée ci-dessous).

## Décisions de conception

**A. Comportement observable strictement inchangé.** Chaque migration
remplace l'élément HTML et son style, jamais la logique — mêmes
`data-testid`, `aria-label`, `type`, gestionnaires, valeurs, états
`disabled`. Suite de tests inchangée sauf ajustements de style
redondant devenus inutiles (aucune assertion de comportement modifiée).

**B. Choix de variante réfléchi par bouton, jamais un défaut aveugle** :

- `primary` (défaut) — action principale d'un formulaire ou d'une
  ligne (soumission, verrouillage, activation).
- `secondary` — action secondaire, annulation, changement de sélection,
  ligne de résultat de recherche cliquable (même précédent que le
  bouton de sélection de ligne de `BackofficeView`, F-038).
- `danger` — un seul nouveau cas dans ce ticket (voir CONTROL PWA
  ci-dessous), aucun autre écran migré n'en avait besoin.

**Nuance « verrouiller »/« activer » (`DevisView::LockButton`,
`LegalPaymentTiersView::ActivateButton`)** — délibérément `primary`,
PAS `danger` : contrairement à la désactivation de compte (F-038,
seul précédent `danger` du projet), ce sont des actions métier
normales à issue positive (retenir un devis, publier un template),
pas des actions destructrices. `danger` reste réservé à ce qui
détruit/annule quelque chose, jamais à « irréversible » au sens
technique seul — cohérence vérifiée : aucun de ces deux écrans
n'utilisait déjà `danger` pour ce genre d'action avant ce ticket.

**C. Style inline redondant supprimé** une fois le composant consommé
(bordures/couleurs/padding ad hoc que le composant fournit déjà) — ne
reste en `style={{}}` que ce qui est réellement spécifique à l'usage
(largeurs de champ étroites déjà choisies, alignement de carte
multi-ligne, etc.).

**D. Contrôles natifs volontairement NON migrés** — cases à cocher
(`type="checkbox"`) et boutons radio (`type="radio"`) dans
`LegalPaymentTiersView`/`DevisView`/`InspectionFormView` : aucun
composant `Checkbox`/`Radio` n'existe dans le design system, et
`Input` est stylé pour un champ texte (bordure, fond, min-height
40px) — l'appliquer à une case à cocher native casserait son
apparence plutôt que de l'améliorer. Même raisonnement pour la
`<textarea>` de `InspectionFormView` (aucune API `Input` ne couvre le
multi-ligne). Laissés bruts, chacun documenté en commentaire à son
emplacement.

## Cas particulier — CONTROL PWA

Signalé explicitement par F-038 comme nécessitant une revalidation
plutôt qu'une migration mécanique (app tactile dédiée 360-430px, pas
d'`AppShell`, discipline 44×44 déjà établie ticket 024). Résultat de
cette revalidation :

- **`InspectionFormView::PhotoThumbnail`** (bouton « Supprimer ») —
  migré vers `Button variant="secondary"`, `minWidth`/`minHeight: 44px`
  conservés explicitement en `style` (test dédié `toHaveStyle`, ticket
  024 — le `minHeight: 44px` du composant seul ne suffit pas à garantir
  `minWidth`).
- **Bouton « ← Missions »** — **volontairement PAS migré.** Style
  « fantôme » délibéré (fond transparent, sans bordure, ticket 024) :
  aucune des 3 variantes `Button` ne rend ce pattern, le forcer via
  `style` aurait écrasé la quasi-totalité du composant pour n'en garder
  que `min-height`/`border-radius`. Un futur variant `ghost`/`tertiary`
  serait le bon véhicule, pas cette migration. Laissé brut, avec son
  test `toHaveStyle({ minHeight: '44px' })` intact.
- **Bouton « Ignorer ma saisie et recommencer »** (résolution de
  conflit) — migré vers `Button variant="danger"` (nouveau cas d'usage
  de `danger` hors `BackofficeView`) : ce clic unique EXÉCUTE l'abandon
  définitif de la saisie locale de l'inspecteur, déjà présenté dans le
  contexte d'alerte du bandeau de conflit — cohérent avec la doctrine
  F-038 (`danger` réservé à ce qui exécute réellement une action
  irréversible).
- **Champ photo (`<input type="file" capture="environment">`)** —
  migré vers `Input`, aucun style spécifique nécessaire.
- **`MissionsListView`** — la carte de mission cliquable (multi-ligne,
  bordée) migrée vers `Button variant="secondary"` avec `style`
  réécrivant la disposition interne (`flexDirection: 'column'`,
  `alignItems: 'flex-start'`, `fontWeight: 400`) : même précédent que
  le bouton de sélection de ligne de `BackofficeView` (F-038), étendu
  ici à un contenu multi-ligne plutôt qu'une ligne de texte simple.

## Entités touchées

- `apps/web/src/App.tsx`, `CountryPackSelector.tsx`, `DevisView.tsx`,
  `LegalPaymentTiersView.tsx`, `LotLedgerPanel.tsx`, `PricingView.tsx`
- `apps/home/src/App.tsx`, `OverviewView.tsx`
- `apps/build/src/views/AllLotsView.tsx`, `ExceptionsView.tsx`
- `apps/control-pwa/src/views/InspectionFormView.tsx`,
  `MissionsListView.tsx`
- Aucun changement dans `packages/design-system` (composants et
  tokens déjà stables depuis F-038/F-043) ni côté backend.

## Scope inclus

- Tous les `<button>`/`<input>`/`<select>` de contrôle interactif réel
  identifiés par audit (grep) dans les 11 fichiers ci-dessus.

## Explicitement hors scope

- Cases à cocher, boutons radio, `<textarea>` — aucun composant dédié
  n'existe encore (voir décision D).
- Un variant `ghost`/`tertiary` pour `Button` — nécessaire pour migrer
  le bouton « ← Missions » de CONTROL PWA, non créé ici (aucun autre
  consommateur ne le réclame encore, même discipline que Select en
  F-038).
- Grille d'espacement (F-043) et échelle typographique (F-042) —
  tokens déjà existants, leur propre migration reste un chantier
  séparé, non rouvert par ce ticket.

## Critères d'acceptation

- [x] Les 11 fichiers listés consomment `Button`/`Input`/`Select` du
      design system pour chaque contrôle interactif réel.
- [x] Comportement observable inchangé (mêmes tests, ajustés seulement
      pour du style redondant devenu inutile).
- [x] CONTROL PWA revalidé au cas par cas, pas migré mécaniquement —
      un cas volontairement exclu et documenté (« ← Missions »).
- [x] Suite complète verte : design-system 103, home 58, build 77,
      web 180, control-pwa 73 (491 tests), zéro régression.
- [x] `tsc --noEmit` propre sur les 4 apps touchées.
- [x] Documentation (ce fichier + section CLAUDE.md dédiée).

## Suivi suggéré (non imposé)

- Variant `ghost`/`tertiary` pour `Button`, si un futur écran a besoin
  du même pattern que le bouton « ← Missions » de CONTROL PWA.
- Composants `Checkbox`/`Radio` du design system, si un futur ticket
  veut aussi harmoniser ces contrôles natifs.
