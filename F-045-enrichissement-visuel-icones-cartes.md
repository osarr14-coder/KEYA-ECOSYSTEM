# Ticket F-045 — Enrichissement visuel (icônes + regroupement en cartes)

## Statut

**Phases 1 (HOME), 2 (BUILD) et 3 (CONTROL PWA) implémentées, testées,
vérifiées en navigateur réel.** Phase 4 (back-office) planifiée
ci-dessous, document validé par l'utilisateur avant implémentation —
discipline posée par la règle CLAUDE.md « un document de ticket
précède toujours l'implémentation » (incident F-040).

## Origine

Retour utilisateur direct pendant une démonstration navigateur en
direct (comptes de démo, données réelles créées via l'API, voir
mémoire de session) : le design, bien qu'accessible et cohérent
(tickets 023/024/F-038…), manque de repères visuels sur toutes les
apps, y compris les écrans « denses » pro — chaque section s'enchaînait
en texte brut (`<h2>` + contenu) sur fond blanc, sans regroupement ni
icône. Portée demandée explicitement : **toute la plateforme** (HOME +
BUILD + CONTROL PWA + back-office), pas seulement HOME.

**Écart de processus reconnu** : la phase 1 (HOME) a été implémentée
directement après une confirmation en prose, avant la rédaction de ce
document — répétition de l'anti-pattern F-040. Corrigé pour les phases
suivantes : ce document est rédigé et validé AVANT tout nouveau
fichier touché.

## Décisions de conception

**A. Nouveau composant `Icon`** (`packages/design-system/src/components/Icon/`)
— tracés SVG dessinés à la main (`paths.ts`), jamais une dépendance npm
(`@phosphor-icons/react` envisagée puis écartée : casserait la
discipline « 100% inline React » du projet, disproportionné pour ~15
tracés). Grille 24x24, trait seul (`stroke="currentColor"`,
`strokeWidth={1.75}`, `fill="none"`), décoratif par défaut
(`aria-hidden`) sauf `title` fourni (`role="img"` + `<title>`). 15
icônes : `home`, `building`, `clipboard-check`, `file-text`, `wallet`,
`shield-check`, `bell`, `search`, `chevron-left`, `chevron-right`,
`alert-triangle`, `check-circle`, `users`, `camera`, `scale`.

**B. Nouveau composant `Card`** (`packages/design-system/src/components/Card/`)
— conteneur de section (bordure `semanticColors.neutral.border`, fond
`semanticColors.neutral.surface`, `border-radius: 10px`, icône + `<h2>`
optionnels). **Distinct d'`AlertBanner`** : `AlertBanner` signale un
problème à traiter (`role="alert"`, fond ambre/rouge) ; `Card` regroupe
une section de contenu neutre — jamais utilisé pour une alerte, jamais
l'inverse. `tone="accent"` colore uniquement l'icône (jamais le fond
entier, pour ne jamais se confondre avec `AlertBanner`).

**C. `AppShell`/`TabBar` gagnent un prop `icon` optionnel**
(`AppModule.icon` / `TabBarTab.icon`) — rétrocompatible : un module/onglet
sans `icon` retombe sur le comportement existant (initiale du libellé en
mode replié pour `AppShell`, aucune icône pour `TabBar`). Remplace aussi
l'emoji 🔔 (Task Inbox) par `Icon name="bell"` — seul emoji du projet,
violait la règle « jamais un emoji comme icône » déjà appliquée
partout ailleurs.

**D. Respect strict de la doctrine 17.3 (densité/vitesse de scan pour
BUILD/CONTROL/back-office, identité de marque réservée à HOME)** —
`Card` (`tone="accent"`) ne réutilise que `semanticColors.progress.fill`
(token neutre déjà existant, ticket 023), **jamais `brandColors`**, qui
reste consommé UNIQUEMENT par `apps/home` (gardé par
`brandGovernance.test.ts`, non modifié par ce ticket — aucune nouvelle
consommation de `brandColors` hors HOME n'est introduite). `Icon`/`Card`
eux-mêmes sont neutres de marque : leur usage sur BUILD/CONTROL/back-office
enrichit la structure (regroupement, repères visuels), jamais la
palette. `levelMeta.ts`/`TrustLevel` intouchés.

## Phase 1 — HOME (implémentée)

- `apps/home/src/App.tsx` : icône par module (`home`/`building`/
  `clipboard-check`/`wallet`/`shield-check`) et par onglet (`home`/
  `file-text`/`clipboard-check`).
- `apps/home/src/views/OverviewView.tsx` : sections « Progression »
  (icône `building`, `tone="accent"`) et « Dernier événement » (icône
  `check-circle`) migrées en `Card`, remplaçant leur `<h2>` manuel.
- `apps/home/src/views/PriorityTaskSummary.tsx` : section « Prochaine
  action » migrée en `Card` (icône `clipboard-check`), `aria-label`
  préservé via le passthrough `Card`.
- `apps/build/src/App.tsx`, `apps/web/src/App.tsx` : icônes de modules/
  onglets ajoutées en même temps que HOME (composants partagés
  `AppShell`/`TabBar`) — **portée limitée à la navigation partagée**,
  le contenu de ces deux apps (Phases 2/4) reste à faire.

**Vérifié en navigateur réel** (backend + 4 apps démarrés, compte
`demo.claude@example.test`) : capture d'écran HOME confirmant icônes de
nav, cloche sans emoji, chevron de repli, et les 3 sections en `Card`
délimitées visuellement. Suite complète (design-system 112, home 58)
verte, `tsc --noEmit` propre.

## Phase 2 — BUILD (implémentée)

- `apps/build/src/views/ExceptionsView.tsx` : les 5 sections (Lots en
  retard, Contrôles à planifier, Capacités manquantes, Réserves
  ouvertes, Documents manquants) migrées en `Card` avec icône dédiée
  (`alert-triangle` / `clipboard-check` / `users` / `alert-triangle` /
  `file-text`) — le contenu « Réserves ouvertes » garde son
  `AlertBanner` interne inchangé (Card encadre, ne remplace pas
  l'alerte). `SECTION_STYLE`/bordures manuelles retirées (redondantes
  avec `Card`).
- `apps/build/src/views/AllLotsView.tsx` : bloc résultats (tableau +
  pagination) encadré en `Card` (icône `building`) — formulaire de
  filtres et bouton d'export laissés hors `Card` (ce sont des
  contrôles, pas du contenu à regrouper).

**Vérifié en navigateur réel** (compte `constructeur@example.test`,
données réelles du lot "Lot 12") : capture d'écran confirmant les 5
cartes distinctes sur Exceptions (icônes visibles, bordures nettes) et
le tableau "Tous les lots" encadré. Suite `apps/build` (77 tests) et
suite complète des 5 packages (500 tests) vertes, `tsc --noEmit`
propre.

## Phase 3 — CONTROL PWA (implémentée)

Cas particulier déjà signalé par F-038/F-044 : pas d'`AppShell` (layout
tactile dédié) — `Card` volontairement non introduit ici (un
`<fieldset>` porte déjà sa propre sémantique de groupe de formulaire,
jamais dupliquée par un second conteneur).

- `MissionsListView.tsx` : icône `clipboard-check` sur le titre « Mes
  missions », icône `building` sur chaque carte de mission (à côté du
  nom de lot) — carte déjà `Button variant="secondary"` (F-044),
  aucune taille tactile modifiée (44px déjà en place, revérifié à
  l'écran).
- `InspectionFormView.tsx` : icône devant chaque `<legend>` de section
  (`clipboard-check` Checklist, `camera` Photos, `check-circle`
  Décision) — nouveau `LEGEND_STYLE` partagé (`display: flex`), aucune
  taille/`min-height` existante modifiée. Le bouton fantôme
  « ← Missions » reste volontairement intact (signalé F-044, non
  couvert par ce ticket).

**Vérifié en navigateur réel** (compte `inspecteur@example.test`,
mission réelle « Lot 12 ») : capture d'écran confirmant les icônes sur
« Mes missions » et les 3 sections du formulaire d'inspection, cible
tactile visuellement inchangée. Un test préexistant connu comme flaky
(`InspectionFormView.test.tsx`, « affiche le conflit... », signalé en
amont de ce ticket, non lié à ces changements) confirmé stable sur 3
relances consécutives (24/24) après la modification. Suite complète
verte (500 tests), `tsc --noEmit` propre.

## Phase 4 — Back-office, apps/web (proposé, pas encore implémenté)

Sections de `BackofficeView.tsx` / `DevisView.tsx` / `PricingView.tsx` /
`LegalPaymentTiersView.tsx` / `LotLedgerPanel.tsx` migrées en `Card`
(icônes : `search`/`file-text`/`wallet`/`scale` selon la section,
cohérent avec les icônes déjà posées sur les onglets `TabBar` de ces
mêmes écrans, Phase 1).

## Hors scope

- Aucune couleur de marque (`brandColors`) hors HOME.
- Aucune dépendance npm d'icônes.
- Aucun changement de comportement métier — présentation uniquement,
  mêmes `data-testid`/`aria-label`/logique partout.
- Aucune modification de `levelMeta.ts`/`TrustLevel`.

## Critères d'acceptation (chaque phase)

- Zéro régression : suite de tests du/des workspace(s) touché(s)
  verte avant/après, comportement observable inchangé.
- `tsc --noEmit` propre sur chaque app touchée.
- Vérification visuelle réelle (capture d'écran contre le backend/les
  4 apps démarrés) par écran modifié, pas seulement `get_page_text`/
  `read_page`.
- `brandGovernance.test.ts` (design-system) toujours vert — aucune
  nouvelle fuite de `brandColors` hors HOME.
- Fichiers séquencés un par un avec vérification à chaque étape,
  jamais un commit massif sans point de contrôle intermédiaire.
