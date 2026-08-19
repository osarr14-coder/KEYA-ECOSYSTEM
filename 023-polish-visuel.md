# Ticket 023 — Polish visuel (HOME, BUILD, CONTROL PWA, back-office)

## Statut
Livré. Branche `feature/frontend-round-2`. Passe de cohérence visuelle sur l'ensemble
des écrans déjà stables — présentation uniquement, aucun changement de logique métier,
de calcul, ni de comportement fonctionnel.

## Objectif
Corriger les incohérences visuelles les plus flagrantes entre écrans (police, état actif
des onglets, boutons, espacement, couleurs dupliquées en dur, présentation divergente
d'une même donnée) en réutilisant/étendant les composants du design system existants —
jamais de logique frontend nouvelle.

## Périmètre — évolution actée avant implémentation
Le périmètre exclusif initial de cette branche (`apps/web`, `apps/control-pwa`,
`packages/design-system`) a été élargi, avec accord explicite préalable, à `apps/home`
et `apps/build` — **strictement pour des changements de présentation** (styles inline,
classNames, imports de composants) : aucune ligne de logique métier, de calcul, ni de
comportement fonctionnel n'a été touchée dans ces deux apps. Liste exhaustive des
fichiers concernés et nature exacte du changement en fin de document.

## Constat de départ (inventaire, avant tout changement)
Aucune des 4 apps n'avait de feuille de style : aucun fichier CSS n'existe nulle part
dans ce monorepo, uniquement des styles inline React. Conséquences directement
observées :
1. Aucune `font-family` déclarée — chaque écran retombait sur la police par défaut du
   navigateur.
2. `aria-current="page"` posé correctement partout (accessibilité) mais AUCUN
   traitement visuel associé — impossible de voir dans quel onglet/module on se trouve.
3. Boutons natifs non stylés partout, aucune cohérence avec le bouton-pilule déjà
   soigné de `StatusBadge`.
4. Même donnée (`progress_percentage`), deux présentations opposées : barre colorée
   dans HOME (`OverviewView`), texte brut `"42%"` dans BUILD (`AllLotsView`).
5. Couleurs dupliquées en dur (`#E5E7EB`, `#34D399`) indépendamment dans `AppShell.tsx`
   et `OverviewView.tsx` — `colors.ts` n'avait qu'un seul token partagé (`alert`).
6. Rythme d'espacement incohérent entre écrans (certains gèrent des `gap` explicites,
   d'autres retombent sur les marges par défaut du navigateur).
7. Erreurs réseau génériques (`<p role="alert">` brut) vs alertes métier (`AlertBanner`
   soigné) — même sévérité, deux présentations.
8. Liste imbriquée de `EvidenceFeedView` sans reset `listStyle`, seule de tout le projet
   dans ce cas.
9. `densityTokens` sous-exploité — seul `AllLotsView` s'en servait réellement.

## Décisions de conception
1. **`GlobalStyles`, un composant monté UNE FOIS par app à sa racine (`main.tsx`)** —
   jamais injecté à l'intérieur d'`AppShell` (qui ne couvre ni l'écran de connexion
   d'apps/web ni CONTROL PWA, qui n'utilise pas `AppShell`). Un composant qui injecterait
   un effet de bord global comme side-effect de son rendu aurait été un anti-pattern —
   montage explicite à la racine, visible et traçable.
2. **Reset minimal et sûr, jamais un système de design complet** : `font-family`
   partagée, `box-sizing: border-box`, suppression des marges `<body>`, `a { color:
   inherit; text-decoration: none }`, `button/input/select/textarea { font-family:
   inherit }`. Aucun reset de bordure/padding de bouton en CSS globale (risque de
   clutter visuel sur des boutons déjà soigneusement positionnés sans avoir été
   individuellement revus) — délibérément laissé hors scope.
3. **`ProgressBar` et `TabBar` extraits en composants partagés du design system**,
   plutôt que redéfinis indépendamment dans HOME et BUILD — même principe déjà appliqué
   à `AppShell`/`StatusBadge`/`AlertBanner` (une seule source de vérité visuelle,
   gouvernance déjà en place au ticket 007). `TabBar` remplace deux implémentations
   `<nav><button aria-current>` strictement dupliquées entre `apps/home/src/App.tsx` et
   `apps/build/src/App.tsx`, sans AUCUN style d'état actif dans les deux cas.
4. **`semanticColors.neutral`/`semanticColors.progress` ajoutés** — `neutral.border`
   remplace les deux `#E5E7EB` dupliqués (`AppShell`, `OverviewView`) ; `progress.fill`
   reprend la MÊME valeur que `TrustLevel.verifie` par coïncidence de goût visuel
   uniquement — volontairement un token SÉPARÉ (une progression de lot n'est pas un
   `TrustLevel`, même raisonnement que StatusBadge vs AlertBanner).
5. **État actif (onglets, module sidebar) distingué par poids de police + bordure,
   JAMAIS la couleur seule** — principe d'accessibilité déjà respecté ailleurs dans ce
   projet (CLAUDE.md, ticket 014, « ne jamais distinguer par la seule couleur »).
6. **Couleur neutre "ink" (`#111827`) pour l'état actif, pas une couleur "accent"
   inventée** — aucune couleur de marque n'existe nulle part dans ce projet ; en
   inventer une pour ce ticket de polish aurait été un choix de produit, pas de
   présentation. Choisie aussi pour être visuellement distincte des 5 teintes
   `TrustLevel` (gris/bleu/orange/vert/violet), aucun risque de confusion.
7. **Toute erreur de chargement (`role="alert"`) réutilise systématiquement
   `AlertBanner`**, plus jamais un `<p role="alert">` brut — règle simple, appliquée
   uniformément partout où elle apparaissait, jamais une distinction arbitraire
   "petite erreur inline" vs "grande erreur pleine page".
8. **`SyncStatusIndicator`/`MissionTypeIndicator` (CONTROL PWA) gardent leur statut de
   composants LOCAUX**, conformément à la décision déjà actée (tickets 010/014) — une
   pastille colorée y a été ajoutée, avec des teintes délibérément différentes des 5
   `TrustLevel` (dont un rouge, qu'aucun `TrustLevel` n'utilise), jamais promus au
   design system par ce ticket (aucun second consommateur ne les réclame).

## Entités touchées

### `packages/design-system` (nouveau/modifié)
- `src/tokens/typography.ts` (nouveau) — `fontFamily` partagée.
- `src/tokens/colors.ts` — `semanticColors.neutral`/`semanticColors.progress` ajoutés.
- `src/components/GlobalStyles/GlobalStyles.tsx` (+ test, nouveau).
- `src/components/ProgressBar/ProgressBar.tsx` (+ test, nouveau).
- `src/components/TabBar/TabBar.tsx` (+ test, nouveau).
- `src/components/AppShell/AppShell.tsx` — bordures tokenisées, lien de module actif
  visuellement distinct.
- `src/index.ts` — exports des nouveaux tokens/composants.

### `apps/web` (périmètre plein)
- `src/main.tsx` — monte `<GlobalStyles />`.
- `src/App.tsx` — erreur de chargement du profil : `<p role="alert">` → `<AlertBanner>`.
- `src/views/BackofficeView.tsx` — espacement (formulaire, liste de résultats, carte de
  détail), toutes les erreurs `role="alert"` → `<AlertBanner>`.

### `apps/control-pwa` (périmètre plein)
- `src/main.tsx` — monte `<GlobalStyles />`.
- `src/App.tsx` — espacement autour du bandeau hors-ligne.
- `src/components/SyncStatusIndicator.tsx` — pastille colorée (teintes distinctes des 5
  `TrustLevel`).
- `src/views/MissionsListView.tsx` — cartes de mission (bordure/radius), espacement.
- `src/views/InspectionFormView.tsx` — fieldsets stylés de façon cohérente, espacement.

### `apps/home` — extension de scope, présentation uniquement (liste exhaustive)
- `src/main.tsx` : **1 import** (`GlobalStyles` depuis `@keya/design-system`) + **1
  ligne JSX** (`<GlobalStyles />` monté avant `<ApiClientProvider>`). Aucune autre
  ligne touchée.
- `src/App.tsx` : **1 import** (`TabBar`) ajouté à l'import existant de
  `@keya/design-system` ; le bloc `<nav aria-label="Sections HOME">` (9 lignes,
  `<button>` par onglet codés à la main) **remplacé par un seul élément**
  `<TabBar tabs={TABS} activeTabId={activeTab} onChange={...} aria-label="Sections
  HOME" />` — mêmes ids/libellés/callback `setActiveTab`, comportement strictement
  inchangé.
- `src/views/OverviewView.tsx` : import `ProgressBar`/`semanticColors` ajoutés ; le
  markup de barre de progression (2 `<div>` imbriqués, couleurs `#E5E7EB`/`#34D399` en
  dur) **remplacé par `<ProgressBar percentage={...} width="200px" />`** (même valeur
  `overview.progress_percentage`, aucun recalcul) ; `gap` ajouté entre les 5 sections de
  la vue ; erreur de chargement `<p role="alert">` → `<AlertBanner>`.
- `src/views/MyActionsView.tsx` : import `AlertBanner`/`semanticColors` ajoutés ;
  erreur de chargement `<p role="alert">` → `<AlertBanner>` ; `gap` + bordure/radius
  ajoutés aux éléments de la liste.
- `src/views/EvidenceFeedView.tsx` : import `AlertBanner`/`semanticColors` ajoutés ;
  erreur de chargement `<p role="alert">` → `<AlertBanner>` ; `gap` + bordure/radius
  ajoutés aux éléments de la liste ; **correctif du bug d'inventaire n°8** — la liste
  imbriquée de documents n'avait jamais de `listStyle:none`/`padding:0`, seule
  incohérence de ce type trouvée dans tout le projet.
- `src/views/PriorityTaskSummary.tsx` : import `AlertBanner` ajouté ; erreur de
  chargement `<p role="alert">` → `<AlertBanner>` ; espacement du titre.

### `apps/build` — extension de scope, présentation uniquement (liste exhaustive)
- `src/main.tsx` : **1 import** (`GlobalStyles`) + **1 ligne JSX**, identique au
  traitement d'`apps/home/src/main.tsx` ci-dessus.
- `src/App.tsx` : **1 import** (`TabBar`) ajouté ; le bloc `<nav aria-label="Sections
  BUILD">` (9 lignes) **remplacé par un seul élément** `<TabBar>` — mêmes ids/libellés/
  callback `setActiveTab`, comportement strictement inchangé.
- `src/views/AllLotsView.tsx` : import `ProgressBar`/`semanticColors`/`AlertBanner`
  ajoutés ; la cellule `{row.progress_percentage}%` (texte brut) **remplacée par
  `<ProgressBar percentage={row.progress_percentage} width="60px" />` + le texte
  `{row.progress_percentage}%` conservé à côté** (même valeur, affichage double
  barre+texte adapté à un tableau dense) ; bordures de tableau tokenisées ; erreur de
  chargement `<p role="alert">` → `<AlertBanner>`.
- `src/views/ExceptionsView.tsx` : import `semanticColors` ajouté ; `gap`/séparateurs
  ajoutés entre les 5 catégories d'exceptions ; carte partagée (bordure/radius/padding,
  constante `ROW_STYLE`) appliquée aux 4 types de ligne (lot en retard, capacité
  manquante, réserve ouverte, document manquant) ; erreur de chargement PUIS 3 erreurs
  d'action inline (affectation, correction, ajout de preuve) : `<p role="alert">` →
  `<AlertBanner>`, uniformément.

## Vérification
- **231 tests frontend** sur les 5 packages (design-system 40 dont 9 nouveaux, web 62,
  home 40, build 37, control-pwa 52) — tous verts, aucune régression. `tsc --noEmit`
  propre sur les 5 packages.
- Aucun test snapshot introduit — ce projet n'en a jamais eu la pratique (vérifié,
  aucun fichier `.snap` nulle part) ; tous les tests existants gardent leurs assertions
  comportementales (texte, rôle ARIA, `aria-current`, valeurs de style explicites via
  `toHaveStyle`) — quelques-unes mises à jour pour refléter le changement de markup
  sanctionné (ex : swap `<p role="alert">` → `<AlertBanner>`), jamais pour masquer une
  régression.
- **Vérifié dans un vrai navigateur, avec un vrai backend** (compte réel `constructeur`,
  redirection réelle vers BUILD port 5174) : police appliquée (`getComputedStyle`),
  onglet actif `Exceptions` avec `font-weight:600`/bordure/couleur distincts de l'onglet
  inactif, module `BUILD` de la sidebar visuellement distinct (bordure gauche + fond),
  liens de navigation sans soulignement bleu par défaut, bascule réelle vers "Tous les
  lots" (tableau + pagination rendus), zéro erreur console. Nettoyage complet après
  coup (serveurs arrêtés, conteneur Postgres retiré, `.env`/`venv` non versionnés).

## Explicitement hors scope
- Un système de type/tailles de titres (`h1`/`h2`/`h3`) — laissé aux tailles par défaut
  du navigateur, cohérentes entre elles (h1 > h2 > h3) ; en construire un nécessiterait
  de revoir le niveau sémantique des titres de chaque écran (certains commencent à h1,
  d'autres à h2/h3), hors du strict périmètre "présentation" de ce ticket.
- Un reset visuel complet des boutons (bordure/padding/fond en CSS globale) — risque de
  clutter sur des boutons non individuellement revus, voir décision de conception n°2.
- Promotion de `SyncStatusIndicator`/`MissionTypeIndicator` au design system — décision
  déjà actée (tickets 010/014), non remise en cause par ce ticket de polish.
- Un composant `Card`/`Button` générique — les styles de carte (bordure/radius/padding)
  restent des constantes locales par fichier (`ROW_STYLE`, `FIELDSET_STYLE`...),
  répétées avec la même valeur plutôt qu'extraites en composant : cohérent avec le
  principe « trois lignes similaires valent mieux qu'une abstraction prématurée »
  (CLAUDE.md racine) — à reconsidérer si un 4ᵉ+ consommateur apparaît.

## Dépendances
Ticket 007 (`AppShell`, `StatusBadge`, `AlertBanner`, `densityTokens` — base réutilisée
par tout ce ticket), ticket 008 (`OverviewView`, origine de la barre de progression
extraite), ticket 009 (`AllLotsView`/`ExceptionsView`, `densityTokens` sous-exploité),
ticket 014 (principe « jamais la couleur seule »).
