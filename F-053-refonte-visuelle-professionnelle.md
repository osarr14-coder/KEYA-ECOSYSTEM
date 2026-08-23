# F-053 — Refonte visuelle vers une direction plus professionnelle

## Contexte

Retour utilisateur direct après revue de l'interface déployée (session du
2026-08-23) : « le design est ridicule, le site ressemble à un brouillon ».
Diagnostic confirmé en relisant le design system réel : `Card` (bordure
1px + `border-radius: 10px`, aucune ombre), `Button` (aucune ombre),
`AppShell` (bande navy plate, repère « K+ » en texte brut), écran de
connexion d'`apps/web` littéralement sans aucun style propre (`<h1>KEYA —
Connexion</h1>` sur un `<form>` nu) — tout est fonctionnellement correct
mais visuellement plat, sans hiérarchie ni profondeur.

Une proposition de direction a été validée avec Assane Sarr via un canevas
de maquettes (Claude Design) avant tout code — voir la conversation.
Décision : conserver l'ADN de marque existant (navy `#0B1D3A` + or
`#C49A2C`, ticket F-039) mais l'exécuter avec de la profondeur (ombres
douces au lieu de bordures plates, dégradés navy maîtrisés, hiérarchie
typographique renforcée par une police à empattement pour les titres).

## Décisions de scope

- **Polish visuel des écrans EXISTANTS, aucune nouvelle donnée fabriquée**
  — la maquette incluait des cartes de statistiques illustratives
  (« Organisations actives : 18 », etc.) explicitement marquées « données
  d'exemple » ; elles ne sont PAS reproduites ici, ce serait inventer un
  contenu non branché sur une vraie donnée backend (contraire à la
  discipline du projet — CLAUDE.md, « aucun calcul frontend »/« jamais de
  donnée inventée »). Seuls les écrans/contenus réels sont retouchés.
- **Deux polices** — `Source Serif 4` (titres `h1`/`h2`/`h3`) + `Public
  Sans` (interface, remplace la pile système générique) — chargées via
  Google Fonts dans `GlobalStyles`. `typography.fontFamily` (corps)
  changé ; nouveau `typography.headingFontFamily` ajouté, jamais fusionnés
  (une police d'interface ne doit jamais dériver silencieusement du choix
  éditorial des titres).
- **Ombres** — nouveaux tokens `--keya-shadow-sm/md/lg` (light + dark,
  même doctrine que le reste de `GlobalStyles`), remplacent la bordure
  plate de `Card` ; `Button` (variantes `primary`/`danger` uniquement,
  `secondary` reste sobre/outlined par cohérence avec son usage actuel).
- **`AppShell`** — bande navy passe d'un aplat à un dégradé
  (`brandColors.navy` → une teinte dérivée plus sombre) ; tests mis à jour
  consciemment (assertions `toHaveStyle({background: brandColors.navy})`
  devenues `toHaveStyle({backgroundImage: ...})`), jamais contournés.
- **Écran de connexion (`apps/web`)** — refonte complète : panneau navy
  narratif à gauche (identité + doctrine Visible Trust) / formulaire à
  droite, remplace le `<form>` nu centré.
- **`ProgramHeroCard`** (HOME) — bande navy en dégradé au lieu d'aplat,
  même ADN que le reste.

## Hors scope

- Toute nouvelle fonctionnalité ou donnée agrégée non déjà calculée
  côté backend.
- BUILD/CONTROL PWA/back-office `apps/web` (hors écran de connexion) —
  polish des primitives partagées (`Card`/`Button`/`AppShell`) suffit à
  les faire hériter de la nouvelle direction sans toucher leur code
  propre ; un futur ticket pourra affiner des écrans spécifiques si
  besoin identifié à l'usage.
