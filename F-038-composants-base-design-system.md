# Ticket F-038 — Composants de base du design system (Button, Input, Select)

## Statut
Livré (branche `feature/frontend-round-2`).

## Contexte

Découvert en diagnostiquant un rapport utilisateur (« apps/web, écran
back-office, rendu quasi sans style ») : `packages/design-system/src/
components/` ne contient **aucun composant `Button`, `Input` ni
`Select`** — seulement `AppShell`, `AlertBanner`, `ApiErrorBanner`,
`StatusBadge`, `ProgressBar`, `TabBar`, `GlobalStyles`. Chaque écran du
projet (4 apps) écrit ses propres `<input>`/`<button>`/`<select>` bruts,
sans traitement visuel au-delà de la mise en page (`display`/`width`/
`margin`) — confirmé dans le DOM rendu réel (login + back-office
authentifié) : bouton "Rechercher" sans aucun attribut `style`, champ de
recherche du header sans bordure ni padding.

**Ce n'est ni une régression, ni un problème d'environnement (dev/prod/
cache)** — ce projet n'a jamais eu de CSS externe (100 % styles inline
React, un seul `<style>` injecté par `GlobalStyles` pour les resets).
Aucune étape de build ne pourrait « perdre » un style qui n'existe nulle
part dans le JSX. Le « chrome » applicatif (`AppShell` : sidebar, nav,
`TabBar`, bordures) est réellement stylé et cohérent — seuls les
CONTRÔLES DE FORMULAIRE natifs n'ont jamais reçu de traitement.

**Pourquoi jamais détecté avant** : chaque audit précédent (ticket 023
polish visuel, ticket 024/025 accessibilité) vérifiait des points réels
mais précis (police, resets, contraste de texte, cible tactile 44×44,
distinguabilité sans couleur) — jamais « l'apparence des boutons/champs ».
Et surtout : **aucune vérification en navigateur de ce projet, y compris
dans cette session (DevisView, LotLedgerPanel), n'avait jamais pris de
vraie capture d'écran** — toutes s'appuyaient sur extraction de texte
(`get_page_text`) ou l'arbre d'accessibilité (`read_page`), qui confirment
contenu et comportement mais jamais l'apparence CSS calculée. Correction
de méthode centrale de ce ticket : toute vérification en navigateur doit
désormais inclure une capture de la page entière.

## Portée

Construire `Button`, `Input`, `Select` dans `packages/design-system`,
basés sur les tokens EXISTANTS (`semanticColors`, `typography`) — aucun
nouveau token de couleur « marque » (doctrine ticket 023 : aucune couleur
de marque dans ce projet en dehors de la palette `TrustLevel`, ticket 003,
qui reste hors de portée de ce ticket).

## Direction visuelle proposée (à valider avant implémentation)

**Button** — deux variantes, pas de troisième pour l'instant (« danger »
laissé de côté, voir Décisions ouvertes) :
- `primary` : fond `#111827` (le ton « encre » déjà utilisé pour l'état
  actif de `TabBar`/`AppShell`, ticket 023 — « couleur neutre, pas une
  couleur de marque inventée »), texte `#FFFFFF`, aucune bordure.
- `secondary` : fond transparent, bordure `1px solid #E5E7EB`
  (`semanticColors.neutral.border`), texte `#111827`.
- `border-radius: 8px` — réutilise la valeur déjà posée par `AlertBanner`
  (`packages/design-system/src/components/AlertBanner/AlertBanner.tsx`),
  jamais une nouvelle valeur inventée.
- Désactivé : `opacity: 0.4`, `cursor: not-allowed`.
- `min-height: 44px` — cible tactile WCAG 2.5.5, déjà la discipline
  établie ailleurs dans ce projet (ticket 024).

**Input / Select** — même famille visuelle :
- Bordure `1px solid #E5E7EB` au repos, `border-radius: 8px`.
- Au focus : bordure `#111827` (même ton « encre » que Button primary,
  cohérence d'un seul « ton d'emphase » dans tout le design system) + un
  anneau `box-shadow: 0 0 0 3px rgba(17,24,39,0.12)` pour un indicateur de
  focus RÉELLEMENT visible (WCAG 2.4.7) — le navire par défaut serait
  perdu en écrasant la bordure sans compensation.

**Piège d'architecture identifié avant implémentation** : `:hover`/
`:focus-visible` sont des pseudo-classes CSS, inexprimables via
`style={{}}` inline seul. Deux options : (a) simuler via état React
(`onFocus`/`onBlur`/`onMouseOver`) — fragile, dupliqué à chaque instance ;
(b) ajouter un petit nombre de règles CSS nommées (`.keya-btn`,
`.keya-input`, `.keya-select`) dans `GlobalStyles` (le seul `<style>` déjà
injecté dans ce projet), les composants leur appliquant une `className`
stable. Option (b) proposée : garde 100 % des VALEURS pilotées par les
tokens JS (comme partout ailleurs), délègue UNIQUEMENT les pseudo-états
interactifs à quelques règles CSS minimales — premier écart du projet vis
-à-vis du « 100 % inline », justifié explicitement (aucune autre option
fiable n'existe pour `:focus-visible` avec cette architecture).

## Décisions tranchées (par l'utilisateur, avant implémentation)

- **Variante `danger`** : un rouge DÉDIÉ (`semanticColors.danger`), pas une
  réutilisation de l'ambre `alert` — catégorie sémantique différente d'une
  alerte non-bloquante, réservé EXCLUSIVEMENT aux boutons de confirmation
  d'une action irréversible (ex. « Confirmer la désactivation »,
  `BackofficeView`), jamais un état d'alerte général. `#B91C1C`/`#FEF2F2`/
  `#7F1D1D` (border-icon/background/text) — même rigueur de contraste que
  la leçon `neutral.textMuted` du ticket 024 : `#DC2626` (≈4,83:1 sur blanc)
  écarté pour la même raison (marge jugée trop faible), `#B91C1C` porte ce
  ratio à ≈6,47:1.
- **Périmètre de migration** : UNIQUEMENT `BackofficeView` (l'écran qui a
  révélé le problème) — pas les autres écrans d'`apps/web`
  (`DevisView`/`PricingView`/`LegalPaymentTiersView`/`LotLedgerPanel`), pas
  `LoginView`, pas HOME/BUILD/CONTROL PWA. Voir « Prochaines étapes »
  ci-dessous.

**Nuance appliquée en migrant `BackofficeView`** : seul le bouton qui
exécute RÉELLEMENT l'action irréversible (« Confirmer la désactivation »)
reçoit `variant="danger"` — le bouton qui l'arme seulement
(« Désactiver ce compte », premier clic, ne fait qu'afficher la
confirmation) reçoit `variant="secondary"`, cohérent avec la formulation
exacte de la décision (« réservé... aux boutons de confirmation d'une
action irréversible »). Le bouton de sélection de ligne dans la liste de
résultats (`{email} — {full_name}`) est aussi migré vers `Button`
(`variant="secondary"`, `justifyContent: 'flex-start'` pour préserver
l'alignement à gauche pleine largeur) — c'est un contrôle interactif réel,
pas seulement un élément de mise en page, et souffrait du même défaut que
les autres boutons bruts de cet écran.

**`Select` construit avec ses tests mais sans consommateur dans ce
ticket** : `BackofficeView.tsx` (le seul écran migré ici) ne contient
aucun `<select>` — vérifié en lisant le fichier en entier avant la
migration. Construit quand même (demande explicite du ticket d'origine :
« Button, Input, Select »), prêt pour le prochain écran qui en aura besoin.

## Critères d'acceptation

- [x] `Button` : variantes `primary`/`secondary`/`danger`, état désactivé,
      cible tactile ≥44px, focus clavier visible.
- [x] `Input`/`Select` : bordure au repos, bordure + anneau au focus,
      cohérents entre eux et avec `Button`.
- [x] Tests écrits AVANT de considérer le ticket terminé (rendu, variantes,
      focus, désactivé, disabled, transmission des props natives,
      `data-testid`/rôle ARIA accessibles). 18 tests dédiés
      (9 Button + 5 Input + 4 Select).
- [x] Vérification en navigateur réel — voir section dédiée ci-dessous
      (limite d'outillage rencontrée et contournée, documentée
      explicitement, pas silencieusement).
- [x] Documentation (ce fichier + `CLAUDE.md`) mise à jour avec la
      décision finale et le résultat de la vérification.

## Architecture — pseudo-classes CSS

Confirmé tel que proposé : trois règles minimales ajoutées à
`GlobalStyles` (`.keya-btn:hover`, `.keya-btn:focus-visible`/
`.keya-input:focus-visible`/`.keya-select:focus-visible`,
`.keya-btn:disabled`) — premier écart du projet vis-à-vis du "100%
inline", explicitement commenté dans le fichier source. Toutes les
VALEURS (couleurs de variante, tailles) restent pilotées par les tokens
JS dans les composants eux-mêmes ; ces règles ne gèrent QUE le
changement d'état lui-même (`:hover`/`:focus-visible`/`:disabled`),
strictement inexprimable via `style={{}}` React seul.

## Vérification en navigateur réel

**Limite d'outillage rencontrée, signalée explicitement plutôt que
contournée silencieusement** : `computer{action:"screenshot"}` a échoué de
façon reproductible dans cet environnement (« the Browser pane is not
displayed, so the page is not compositing frames »), y compris après
`tabs_select` pour amener l'onglet au premier plan et une nouvelle
tentative après une pause — testé 3 fois, jamais transitoire. Une vraie
capture d'écran pixel n'a donc pas pu être produite pour cette
vérification, malgré la demande explicite de l'utilisateur. Substitué par
une inspection DOM/CSS RÉELLE via `javascript_tool`
(`getComputedStyle()` sur les éléments réellement rendus) — méthode
fiable, déjà éprouvée lors du diagnostic qui a initié ce ticket, mais qui
reste un texte structuré, pas une image. Ce compromis est documenté ici
pour transparence, pas présenté comme équivalent à une capture d'écran.

**Backend réellement démarré** (Postgres du ticket F-037 réutilisé, même
volume Docker nommé — données déjà seedées, aucune migration à rejouer),
Django + Vite (`apps/web`, port 5176) démarrés manuellement (contournement
documenté depuis le ticket 021 : `preview_start({name})` échoue sur cette
machine dès que le chemin de l'exécutable contient un espace). Une
`Membership admin_keyimmo` a dû être créée manuellement (aucune n'existait
plus sur les données réutilisées, `Membership.objects.count() == 0`) via
`apps.core.rls.set_rls_context` dans une transaction — même schéma que le
bootstrap RLS déjà documenté ailleurs dans ce projet, pas un nouveau
mécanisme.

**Résultats observés (valeurs CSS calculées réelles, pas du code lu)**,
sur l'écran back-office authentifié :
- Bouton « Rechercher » (primary) : `background: rgb(17, 24, 39)`
  (`#111827`), `color: rgb(255, 255, 255)`, `border-radius: 8px`,
  `min-height: 44px`, classe `keya-btn`.
- Lignes de résultats de recherche + bouton « Annuler » (secondary) :
  `background: rgba(0, 0, 0, 0)` (transparent), `border: 1px solid
  rgb(229, 231, 235)` (`#E5E7EB`), texte `rgb(17, 24, 39)`.
- Bouton « Confirmer la désactivation » (danger) : `background: rgb(185,
  28, 28)` (`#B91C1C`, le token dédié), `color: rgb(255, 255, 255)` —
  visuellement distinct de l'ambre `alert` et du `primary` encre.
- Champ de recherche : `border: 1px solid rgb(229, 231, 235)`,
  `border-radius: 8px`, `min-height: 40px`, classe `keya-input`.
- **Focus clavier RÉEL** (touche Tab physique via l'outil `computer`, pas
  un `.focus()` scripté — un `.focus()` JS ne déclenche pas de façon
  fiable `:focus-visible` selon le navigateur, testé et écarté) : le
  bouton « Annuler » obtenu par Tab confirme `matches(':focus-visible')
  === true` et `box-shadow: rgba(17, 24, 39, 0.12) 0px 0px 0px 3px` —
  l'anneau de focus WCAG 2.4.7 fonctionne réellement, pas seulement dans
  le code source.

Aucune action destructive exécutée pendant la vérification (« Annuler »
cliqué pour fermer le flux, jamais « Confirmer la désactivation »).
Nettoyage effectué après vérification : serveurs Django/Vite arrêtés,
conteneur Docker supprimé (`docker compose down`, volume préservé).

## Prochaines étapes (tickets séparés, hors scope de F-038)

Migration séquencée du reste du projet vers `Button`/`Input`/`Select`,
dans cet ordre suggéré (pas imposé) :
1. Les autres écrans d'`apps/web` — `LoginView`, `DevisView`,
   `PricingView`, `LegalPaymentTiersView`, `LotLedgerPanel` — chacun avec
   ses propres boutons/champs bruts non encore migrés.
2. HOME (`apps/home`) — formulaires/actions non encore recensés.
3. BUILD (`apps/build`) — idem, y compris `ExceptionsView`/`AllLotsView`.
4. CONTROL PWA (`apps/control-pwa`) — cas particulier : n'utilise pas
   `AppShell`, layout tactile dédié (voir CLAUDE.md, section CONTROL
   PWA) — `min-height`/tailles à revalider pour cet usage spécifiquement
   tactile plutôt qu'une migration mécanique.

## Dépendances
Aucune — ticket purement frontend, `packages/design-system` + migration
de `BackofficeView` (`apps/web`), zéro changement backend.
