# Ticket 025 — Audit d'accessibilité + maquette Devis/Appels d'offres

## Statut
Livré. Branche `feature/frontend-round-2`. Deux tâches successives : (1) audit
d'accessibilité sur les écrans déjà livrés, correction de ce qui peut l'être sans
changement de comportement fonctionnel ; (2) maquette visuelle uniquement pour un futur
écran admin Devis/Appels d'offres, réutilisant `AppShell`/le design system.

Numéroté 025 (pas 024) pour éviter toute collision avec `024-reconciliation-devis-
ajustement.md`, en cours dans un worktree séparé (backend, hors périmètre de cette
session) au moment de ce ticket.

## Partie 1 — Audit d'accessibilité

### Méthode
Revue systématique de `packages/design-system` (composants partagés — un correctif ici
profite automatiquement à toutes les apps qui les consomment) et des 4 apps déjà
livrées (HOME, BUILD, CONTROL PWA, back-office), sur les axes demandés : focus clavier,
labels accessibles, contrastes, cibles tactiles (CONTROL PWA), dépendance à la seule
couleur. Périmètre d'AUDIT (lecture) : les 4 apps. Périmètre de CORRECTION directe :
`apps/web`, `apps/control-pwa`, `packages/design-system` — périmètre exclusif de cette
session, reconfirmé explicitement pour ce ticket (contrairement au ticket 023, où
`apps/home`/`apps/build` avaient été explicitement élargis). Tout constat touchant HOME/
BUILD au-delà de ce que le design system corrige automatiquement est documenté comme
dette, pas corrigé.

### Constats déjà conformes (vérifiés, aucun correctif nécessaire)
- **Focus clavier** : aucun `outline` n'est désactivé nulle part dans le projet (`grep
  -i outline` sur `apps/` et `packages/` : aucune occurrence) — l'anneau de focus par
  défaut du navigateur reste visible partout.
- **Labels accessibles** : tous les `<input>`/`<select>`/`<textarea>` du projet sont
  englobés par un `<label>` texte, souvent doublé d'un `aria-label` explicite (revue
  exhaustive de tous les `<input>` des 4 apps). Aucun champ sans nom accessible trouvé.
- **Dépendance à la seule couleur** : `TabBar`/`AppShell` (état actif : poids de police
  + bordure, jamais la couleur seule), `SyncStatusIndicator` (pastille colorée + texte),
  `MissionTypeIndicator` (texte seul, aucune couleur) — tous distinguables sans couleur.
  Complète la vérification déjà faite sur `StatusBadge` au ticket 007 (forme SVG + texte
  — un test dédié compare les `d` de path rendus, pas seulement une étiquette).

### Correctifs appliqués

**`packages/design-system` :**
- `semanticColors.neutral.textMuted` : `#6B7280` → `#4B5563`. Le premier mesurait
  4,83:1 sur fond blanc — au-dessus du minimum WCAG AA texte normal (4,5:1) mais avec
  une marge de sécurité trop faible (~7 %) pour un ton utilisé comme texte secondaire
  quasiment partout (dates, sous-titres, libellés muets). Le second porte ce ratio à
  ~7,5:1 (niveau AAA), sans changement de teinte perceptible. Se propage automatiquement
  partout où le token est utilisé (HOME, BUILD, apps/web, apps/control-pwa après
  tokenisation ci-dessous).
- `ProgressBar` : la piste (`progress.track`, `#E5E7EB`) sur fond de page blanc mesurait
  ~1,2:1, très en dessous du minimum WCAG 1.4.11 (contraste non textuel, 3:1 requis pour
  la frontière d'un composant d'interface) ; le remplissage contre la piste mesurait
  ~1,55:1, également insuffisant. Une bordure explicite (`neutral.textMuted`, donc
  ~7,5:1 après le correctif ci-dessus) définit désormais la frontière du composant
  indépendamment du fond de page. Sévérité limitée en pratique : le pourcentage exact
  reste TOUJOURS affiché en texte à côté (`OverviewView`/`AllLotsView`), jamais porté
  par la seule barre. `aria-valuetext` ajouté (`"37 %"`) pour une annonce lecteur
  d'écran plus naturelle que la valeur numérique brute.
- `StatusBadge` : le popover (`role="dialog"`) n'avait aucun moyen clavier de se
  refermer (seuls le clic extérieur et un second clic sur le bouton fonctionnaient) —
  ajout d'un gestionnaire `Escape`, addition pure, aucune interaction souris existante
  changée. Bordure du popover (`#E5E7EB` en dur) tokenisée vers `semanticColors.neutral.
  border`.

**`apps/control-pwa` :**
- 5 occurrences de couleurs dupliquées en dur (`#6B7280`/`#E5E7EB`, posées par erreur au
  ticket 023 malgré la leçon de ce même ticket sur la duplication de tokens) remplacées
  par des imports de `semanticColors` — `MissionsListView.tsx`, `InspectionFormView.tsx`.
  Conséquence directe : ces couleurs bénéficient automatiquement du correctif de
  contraste ci-dessus.
- **Régression de cible tactile introduite au ticket 023, corrigée** : le bouton
  « ← Missions » avait reçu `padding: 0` pour un rendu visuel "fantôme" — réduisait sa
  cible tactile bien en dessous de 44×44 (WCAG 2.5.5), app explicitement tactile
  (360-430px). `minHeight: 44px` + `display: inline-flex` restaurent une cible correcte
  sans ajouter de bordure/fond visible.
- Bouton « Supprimer » par photo (`PhotoThumbnail`) : aucune taille minimale garantie
  avant ce ticket — `minWidth`/`minHeight: 44px` ajoutés.
- Bouton « Ignorer ma saisie et recommencer » (résolution de conflit) : `minHeight:
  44px` ajouté par cohérence/sécurité, même si son padding par défaut le rendait déjà
  probablement suffisant.

### Dette documentée (non corrigée dans ce ticket)

1. **Contraste des 5 couleurs `TrustLevel` (`StatusBadge`/`levelMeta.ts`) — constat le
   plus significatif de cet audit, PAS corrigé unilatéralement.** Mesurées comme
   couleur de texte directe sur fond blanc/transparent (`color: meta.color`, `background:
   transparent`) :
   - `declare` `#9CA3AF` → **2,54:1**
   - `documente` `#60A5FA` → **2,54:1**
   - `controle` `#F59E0B` → **2,14:1**
   - `verifie` `#34D399` → **1,92:1**
   - `valide` `#8B5CF6` → **4,23:1**
   Les 5 échouent le minimum WCAG AA texte normal (4,5:1). Différent de ce qui a été
   testé au ticket 007 : ce test-là vérifie la distinguabilité SANS couleur (forme SVG +
   texte, critère 1.4.1) — jamais le contraste lui-même (critère 1.4.3), qui n'avait
   jamais été mesuré. Non corrigé ici volontairement : c'est la palette DOCTRINE
   « Visible Trust » (ticket 003), établie et référencée dans des dizaines de tickets
   comme l'unique exception à « aucune couleur de marque dans ce projet » (voir ticket
   023) — la changer unilatéralement, même pour un motif technique valide, dépasse le
   mandat d'un audit de polish. Recommandation pour confirmation : foncer chaque teinte
   en conservant la même famille de couleur (ex. viser ~4,5-5:1 minimum), plutôt que
   documenter comme un simple `TODO`.
2. **`ProgressBar` sans `aria-label` côté appelant** — `OverviewView.tsx` (HOME) et
   `AllLotsView.tsx` (BUILD) n'passent aucun `aria-label`, laissant le composant annoncé
   sans contexte ("progressbar, 37 %" sans dire de quoi). Correctif trivial (une ligne
   par site d'appel) mais qui touche `apps/home`/`apps/build`, non autorisés pour ce
   ticket (contrairement au 023).
3. **Liens de navigation sans distinction visuelle à l'état inactif**
   (`AppShell`/breadcrumb, depuis le reset `a { text-decoration: none }` du ticket 023)
   — analysé contre l'exception WCAG reconnue pour les menus de navigation (SC 1.4.1,
   "Understanding" : une liste de liens groupée et étiquetée comme navigation, où CHAQUE
   élément est un lien, n'a pas besoin d'un signal non-couleur individuel). `AppShell`
   (`aria-label="Navigation des modules"`) et le fil d'Ariane (`aria-label="Fil
   d'Ariane"`) correspondent tous deux à ce cas — jugé ACCEPTABLE après analyse, pas un
   gap silencieux.
4. **Cibles tactiles des tableaux denses HOME/BUILD** (bascule Dense/Confortable,
   pagination) — WCAG 2.5.5 est un critère AAA, moins critique pour une interface admin
   à usage souris/desktop qu'une app tactile comme CONTROL PWA. Jugé acceptable pour ce
   contexte, non retouché.

### Vérification
- **246 tests frontend** sur les 5 packages (design-system 44 dont 4 nouveaux, web 71,
  home 40, build 37, control-pwa 54 dont 2 nouveaux) — tous verts. `tsc --noEmit` propre.
- Nouveaux tests ciblés : `StatusBadge` (Escape ferme le popover, une autre touche ne le
  ferme pas), `ProgressBar` (bordure présente, `aria-valuetext`), `InspectionFormView`
  (cibles tactiles ≥44px sur les deux boutons corrigés).

## Partie 2 — Maquette Devis / Appels d'offres (`apps/web`)

### Nature de la maquette
`apps/web/src/views/DevisAppelOffreMockup.tsx` — **aucun code fonctionnel** :
- N'importe ni `useApiClient` ni `ApiClientContext` — structurellement impossible qu'un
  appel réseau parte de ce fichier.
- Toutes les données (`MOCK_LOTS`) sont statiques, codées en dur dans le fichier.
- Chaque bouton d'action (« Verrouiller », « Saisir un devis pour ce lot ») est rendu
  `disabled`, avec un `title` explicite renvoyant vers l'endpoint réel déjà existant
  (ticket 022) — jamais un bouton qui a l'air de marcher sans marcher.
- Vérifié explicitement par un test qui stub `fetch` et clique sur TOUTE action
  disponible : zéro appel réseau.

### Périmètre reflété — strictement ce qui est stable et fusionné (ticket 022)
- Liste des devis d'un lot avec montants (réservé `admin_keyimmo`, seul rôle qui voit
  jamais un montant, ticket 022).
- Statut dérivé « Candidat » / « Verrouillé » — composant local `DevisStatusIndicator`,
  PAS `StatusBadge` (même raisonnement déjà appliqué à `MissionTypeIndicator`/
  `SyncStatusIndicator` : ce statut n'est pas un des 5 niveaux Visible Trust).
- Actions représentées visuellement (désactivées) : créer un devis, verrouiller un
  devis — les deux endpoints réels du ticket 022.

### Explicitement absent — statut « gagnant », dépend du ticket 024
Aucune ligne de devis n'affiche de statut « gagnant ». Une section dédiée, en bordure
pointillée pour la distinguer visuellement du reste de l'écran, l'indique en toutes
lettres : **« Statut « gagnant » — à câbler une fois le ticket 024 fusionné »**, avec le
détail (dépliable) de ce qui reste à câbler : séquencement du statut (sélection vs
réconciliation réussie du `DevisAjustement`), affichage de la marge disponible et de
l'écart, traitement du cas limite écart = marge exacte vs écart {'>'} marge, aucun appel
réseau de réconciliation. Testé explicitement : `screen.queryByText(/gagnant$/i)`
n'apparaît jamais comme statut d'une ligne de devis, seulement dans ce titre de section.

### Intégration dans apps/web
Un second module `AppShell` (« Devis / Appels d'offres ») apparaît à côté de
« Back-office » (ticket 021) — bascule via `TabBar` (même composant déjà réutilisé par
HOME/BUILD, ticket 023), jamais un mécanisme de navigation parallèle. Garde d'accès
`admin_keyimmo` inchangée (`hasAdminKeyimmoAccess`, ticket 021), s'applique aux deux
onglets identiquement.

### Vérification
- 8 nouveaux tests (`DevisAppelOffreMockup.test.tsx`) + 1 test de bascule d'onglet
  (`App.test.tsx`) — inclus dans les 71 tests `apps/web` ci-dessus.
- **Vérifié dans un vrai navigateur, avec un vrai backend** (compte admin réel,
  connexion réelle) : les deux onglets s'affichent dans la sidebar ET la `TabBar`,
  bascule réelle vers la maquette, les deux lots mockés et leurs devis s'affichent
  correctement (statuts « Verrouillé »/« Candidat » corrects), la section « à câbler »
  se déplie au clic, **zéro requête réseau** vers un endpoint `procurement`/`devis`
  pendant toute la session (confirmé via `read_network_requests`), zéro erreur console.
  Nettoyage complet après coup (serveurs arrêtés, conteneur Postgres retiré, aucun
  résidu).

## Explicitement hors scope
- Câblage réel de la maquette à l'API (attend la stabilisation du ticket 024).
- Correction des 5 couleurs `TrustLevel` — dette documentée, décision produit à
  confirmer avant tout changement (voir « Dette documentée » ci-dessus).
- `aria-label` sur `ProgressBar` côté HOME/BUILD — dette documentée, hors périmètre
  autorisé pour ce ticket.
- Tout composant `Button`/`Card` générique — cohérent avec la position déjà prise au
  ticket 023 (« trois lignes similaires valent mieux qu'une abstraction prématurée »).

## Dépendances
Ticket 003 (doctrine Visible Trust, palette `TrustLevel` évaluée mais non modifiée),
ticket 007 (`StatusBadge`, test de distinguabilité sans couleur), ticket 011/021
(back-office, garde `admin_keyimmo`), ticket 022 (`Devis`/`Candidature`/`AppelOffre`,
périmètre reflété par la maquette), ticket 023 (`TabBar`/`ProgressBar`/`GlobalStyles`,
régression de cible tactile corrigée ici), ticket 024 (réconciliation devis/ajustement,
en cours ailleurs — le statut « gagnant » en dépend explicitement).
