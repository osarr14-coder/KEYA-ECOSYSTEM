# Ticket F-046 — Raffinement de la direction visuelle institutionnelle HOME

## Statut

**Implémenté, testé, vérifié en navigateur réel. Terminé.** Décisions
D/programName/E confirmées explicitement par l'utilisateur avant tout
code. Suite complète verte (511 tests sur les 5 packages), `tsc
--noEmit` propre, `brandGovernance.test.ts` étendu et vert.

## Origine

Demande explicite de l'utilisateur : ne pas ouvrir une nouvelle
direction visuelle, mais approfondir celle déjà posée sur HOME par le
ticket F-039 (identité de marque KEYIMMO AFRIC, navy `#0B1D3A` / or
`#C49A2C`, doctrine « solennité/confiance » réservée à HOME).

Référence visuelle validée par l'utilisateur : carte avec en-tête navy
plein contenant le logo K+toit et le nom du programme, badge or
discret, carte de contenu blanche avec bordure légère, progression en
barre fine avec remplissage or, bouton d'action principal en navy
plein avec texte blanc.

## Audit — état réel de HOME après F-039 (et F-045)

**Confirmé par lecture directe du code, pas par supposition :**

- `brandColors` (`packages/design-system/src/tokens/colors.ts`) : deux
  valeurs seulement, `navy: '#0B1D3A'`, `gold: '#C49A2C'` — inchangées
  depuis F-039.
- **Consommateurs actuels de `brandColors`, exhaustif (`grep` sur tout
  le repo)** : `AppShell.tsx` (gated par le prop `brand`, appliqué
  UNIQUEMENT au bandeau `<header>` de `AppShell` — fond navy, bordure
  basse or 2px, repère textuel « K+ » or + « KEYIMMO AFRIC ») et
  `apps/home/src/views/PriorityTaskSummary.tsx` (CTA « Voir toutes mes
  actions », actuellement `variant="secondary"` avec bordure or 2px +
  texte navy, fond transparent). **Rien d'autre ne référence
  `brandColors`** — ni `OverviewView.tsx`, ni `App.tsx`, ni `Card`,
  ni `ProgressBar`, ni `Button` en dehors de cette seule ligne.
- **`OverviewView.tsx`, hero actuel** : `<header data-testid="hero">`
  entièrement neutre — `<h1>` (asset_name) + texte gris (program_name/
  lot_name/asset_location), bouton « Actualiser » (`variant="secondary"`)
  juste à côté. Aucune carte, aucun fond coloré, aucun logo.
- **Sections « Progression »/« Dernier événement »** : déjà migrées en
  `Card` (F-045) — bordure `semanticColors.neutral.border`, fond
  `semanticColors.neutral.surface`, `border-radius: 10px` — **cette
  partie correspond DÉJÀ à la référence** (« carte de contenu blanche
  avec bordure légère »), aucun changement nécessaire sur `Card`
  lui-même.
- **`ProgressBar.tsx`** : remplissage figé sur `semanticColors.progress.fill`
  (`#34D399`, vert), aucune prop de couleur exposée — impossible
  aujourd'hui de le personnaliser sans toucher le composant.
- **`Button.tsx`** : `variant="primary"` = fond `semanticColors.neutral.text`
  (encre quasi-noire), texte blanc — jamais navy. Un `style` passthrough
  existe déjà (`{ ...variantStyle, ...style }}`) : un override ponctuel
  au niveau consommateur fonctionne SANS toucher `Button.tsx`, même
  précédent déjà utilisé par `PriorityTaskSummary` pour l'accent or.
- **Aucun asset logo « K+toit »** n'existe dans le repo (reconfirmé,
  recherche exhaustive `.svg`/`.png`/`.jpg` — même constat qu'à F-039,
  toujours vrai).
- **`brandGovernance.test.ts`** : scanne `AlertBanner`/`StatusBadge`/
  `ProgressBar`/`Button`/`Input`/`Select` à la recherche de la chaîne
  `"brandColors"` (échec si trouvée), plus un contrôle positif sur
  `AppShell`. **`Card`, `Icon`, `TabBar` ne sont PAS dans cette liste**
  (créés après ce test, F-045) — trou de couverture réel, sans
  conséquence pour ce ticket si aucun de ces fichiers ne reçoit
  jamais le littéral `"brandColors"` (voir Décision C ci-dessous).
- **`levelMeta.ts`/`TrustLevel`** : aucune donnée HOME actuelle
  (badge, couleur) n'en dérive une nouvelle valeur ; `StatusBadge`
  reste strictement au périmètre des 5 niveaux Visible Trust.

## Décisions proposées

**A. Nouveau composant HOME-only `ProgramHeroCard`**
(`apps/home/src/components/ProgramHeroCard.tsx`) — remplace le
`<header data-testid="hero">` actuel d'`OverviewView.tsx`. **Jamais une
extension de `Card` partagé** : la bande navy pleine + logo est un
besoin visuel propre à ce seul écran, aucun autre consommateur de
`Card` (BUILD/CONTROL/back-office) n'en a besoin — l'introduire dans
le composant partagé grossirait son API pour un seul appelant, et
augmenterait le risque de régression sur ses 3 autres consommateurs
pour aucun bénéfice. Garde le principe déjà établi par F-039 : toute
valeur `brandColors` reste au plus près de son seul consommateur réel.
- Structure : conteneur externe (bordure `neutral.border`, `border-
  radius: 10px`, `overflow: hidden` pour que la bande navy épouse les
  coins arrondis) → bande d'en-tête pleine largeur (fond
  `brandColors.navy`, texte `#FFFFFF` — même paire déjà en production
  sur `AppShell`, contraste ≈16,8:1, largement AAA, non recalculé pour
  rien puisque c'est exactement la même paire déjà vérifiée) → corps
  blanc (`neutral.surface`).
- Bande d'en-tête : repère « K+ » (or, `fontWeight: 700`, MÊME
  traitement que le repère `AppShell`, jamais un nouveau style
  inventé) + nom du programme (`program_name`), poids 600, taille
  `1.1em` (réutilise l'échelle `h3` déjà posée par F-042, appliquée en
  style inline plutôt qu'une vraie balise `<h3>` — un `<h3>` avant le
  `<h1>` du corps casserait l'ordre des niveaux de titre,
  accessibilité).
- Corps blanc : contenu actuel inchangé — `<h1>` (asset_name), texte
  gris (program_name/lot_name — répété une fois ici car déjà dans la
  bande navy, et une fois dans le corps pour le contexte complet —
  ambiguïté à trancher, voir note ci-dessous), `asset_location`,
  bouton « Actualiser » (`variant="secondary"`, reste ici, PAS dans la
  bande navy — un bouton `secondary` sur fond navy serait illisible,
  texte encre sur navy).
- Espacements en `px` via les tokens `spacing` existants (F-043,
  discipline déjà établie — px, pas em, pour l'espacement/le
  rayon, contrairement à la typographie) : bande d'en-tête
  `spacing.md`/`spacing.lg` (12px/16px), corps `spacing.lg` (16px),
  cohérent avec le padding déjà utilisé par `Card`.
- `data-testid="hero"` conservé sur le conteneur racine — la suite
  `OverviewView.test.tsx` existante (vérifie que les 4 champs texte
  sont présents dans ce conteneur) reste verte SANS modification.

**Point à trancher explicitement avant implémentation** : le nom du
programme apparaîtrait deux fois (bande navy + `program_name` déjà
affiché dans le corps, ligne `program_name — lot_name`). Proposition :
retirer `program_name` de la ligne du corps (garder seulement
`lot_name`), pour éviter la redite — mais c'est un changement de
contenu, pas seulement de style, donc signalé ici plutôt que décidé
seul.

**B. `ProgressBar` — nouvelle prop générique `fillColor`** (optionnelle,
défaut `semanticColors.progress.fill` inchangé partout ailleurs) :
`apps/home/src/views/OverviewView.tsx` passe `fillColor={brandColors.gold}`
sur la seule barre de la section « Progression ». Générique et neutre
de marque au niveau du composant partagé (aucun littéral
`"brandColors"` dans `ProgressBar.tsx`, seulement une couleur reçue en
prop) — même famille de solution que le `style` passthrough de
`Button`, cohérent avec la doctrine « brandColors jamais dans un
composant partagé, seulement chez son appelant HOME ».

**C. CTA `PriorityTaskSummary` — navy plein, pas accent bordure**
Remplace `variant="secondary"` + bordure or/texte navy par
`variant="primary"` + `style={{ background: brandColors.navy }}`
(`Button` primary pose déjà `color: '#FFFFFF'` par défaut — aucun
autre override nécessaire). **Zéro changement à `Button.tsx`** :
passthrough `style` déjà existant. Le raisonnement F-039 qui avait
écarté un remplissage or (contraste ≈2,6:1, échec WCAG AA) ne
s'applique PAS ici : c'est un remplissage NAVY, pas or — paire
navy/blanc déjà vérifiée en A ci-dessus.

**D. Badge or discret — proposition, confiance modérée, à confirmer
en priorité.** Aucune donnée HOME actuelle (`LotOverview`/`MyLot`) ne
porte une information « badge-shaped » nouvelle sans changement
backend (vérifié : `MyLotSerializer` n'expose que `name`/`asset_name`/
`asset_location`/`program_name`) — inventer un badge déconnecté de
toute donnée réelle serait un habillage sans substance. Proposition :
**pas de nouveau composant badge** — le repère « K+ » or (déjà
introduit en A, répété entre `AppShell` et `ProgramHeroCard`) EST le
badge discret demandé, cohérent avec la référence (un seul repère de
marque or, pas un widget supplémentaire). Si un vrai badge distinct
est attendu (ex. un statut, un label pays), il faudrait d'abord
identifier la donnée réelle à afficher — hors scope tant que non
précisé.

**E. Gouvernance — `brandGovernance.test.ts` (optionnel, à confirmer)**
Ajouter `'Card'`, `'Icon'`, `'TabBar'` à `FORBIDDEN_COMPONENT_DIRS`
(actuellement absents, créés après ce test par F-045) — ferme un trou
de couverture réel repéré pendant cet audit. Non strictement requis
par ce ticket (aucun de ces fichiers ne reçoit `brandColors` dans la
conception ci-dessus), mais cohérent avec la doctrine et peu coûteux.
Décision séparée du reste — dites si à inclure ou non.

## Scope définitif

- `apps/home/src/components/ProgramHeroCard.tsx` (nouveau) +
  `ProgramHeroCard.test.tsx` (nouveau).
- `apps/home/src/views/OverviewView.tsx` — hero remplacé par
  `ProgramHeroCard`, `fillColor` ajouté sur le `ProgressBar` de la
  section Progression.
- `apps/home/src/views/PriorityTaskSummary.tsx` — CTA navy plein.
- `packages/design-system/src/components/ProgressBar/ProgressBar.tsx`
  (+ test) — prop `fillColor` optionnelle.
- `apps/home/src/views/PriorityTaskSummary.test.tsx` — le test
  existant (« porte l'accent de marque… ») sera RÉÉCRIT pour vérifier
  le nouveau remplissage navy, pas juste laissé passer par hasard.
- `apps/home/src/views/OverviewView.test.tsx` — inchangé si possible
  (voir point A) ; ajusté seulement si le retrait de `program_name` du
  corps est confirmé.
- Optionnel (décision E) : `packages/design-system/src/brandGovernance.test.ts`.
- `CLAUDE.md` — nouvelle section ticket F-046 ; registre de données
  de démo mis à jour UNIQUEMENT si la vérification visuelle crée une
  donnée nouvelle (probable que non — la donnée déjà enregistrée,
  « Résidence Baobab »/`demo.claude@example.test`, suffit à vérifier
  ce changement purement présentationnel).

## Hors scope

- Toute extension de `brandColors` (navy/or) à BUILD/CONTROL/
  back-office — reste strictement réservé à `apps/home`.
- Toute modification de `levelMeta.ts`/`TrustLevel`, ou de
  `StatusBadge`.
- Tout asset logo réel (« K+toit ») — n'existe toujours pas, repère
  textuel seul, comme F-039.
- Toute modification du composant `Card` partagé (voir Décision A).
- `EvidenceFeedView.tsx`/`MyActionsView.tsx` — non concernés par la
  référence visuelle donnée, non touchés.

## Critères d'acceptation

- [x] `ProgramHeroCard` : bande navy plein (`#0B1D3A`) + repère « K+ »
      or + nom du programme, corps blanc avec le contenu existant,
      `data-testid="hero"` conservé.
- [x] `ProgressBar` de la section Progression : remplissage or
      (`#C49A2C`), piste/bordure inchangées ; tout autre usage de
      `ProgressBar` (BUILD notamment) reste vert `#34D399` par défaut,
      zéro régression.
- [x] CTA « Voir toutes mes actions » : fond navy plein, texte blanc.
- [x] `brandGovernance.test.ts` toujours vert (aucune fuite hors HOME) ;
      `Card`/`Icon`/`TabBar` ajoutés (décision E confirmée) et
      toujours verts après l'ajout.
- [x] Zéro régression : suite complète des 5 packages verte (511
      tests — baseline 500 + 11 nouveaux/modifiés : +5 design-system,
      +6 home), `tsc --noEmit` propre sur `apps/home` et
      `packages/design-system`.
- [x] Vérification visuelle réelle effectuée — voir section dédiée
      ci-dessous.

## Décisions confirmées par l'utilisateur (avant implémentation)

- **D** : le repère « K+ » or existant fait office de badge, aucun
  nouveau widget.
- **`program_name`** : retiré de la ligne du corps blanc, ne reste que
  dans la bande navy — un seul affichage.
- **E** : `brandGovernance.test.ts` étendu à `Card`/`Icon`/`TabBar`
  UNIQUEMENT — `ProgressBar` était déjà couvert (pas d'ajout
  nécessaire) ; `ProgramHeroCard` vit dans `apps/home`, hors du
  répertoire scanné par ce test (`packages/design-system/src/
  components/`), et c'est voulu : c'est précisément le composant
  autorisé à consommer `brandColors`. Précision apportée avant
  implémentation, pas une divergence par rapport à la demande.

## Ajustement fait en cours d'implémentation (dans le périmètre de la
## décision B, pas une nouvelle décision séparée)

`Card` de la section « Progression » (`OverviewView.tsx`) avait
`tone="accent"` (icône verte, `semanticColors.progress.fill`) —
retiré (retombe sur `tone` neutre par défaut) : une fois la barre
remplie en or, garder l'icône verte aurait suggéré deux accents
« progression » différents dans la même carte. L'accent or reste
porté par la seule barre, cohérent avec la référence.

## Vérification visuelle réelle

**Backend + `apps/home` (port 5173) démarrés, compte
`demo.claude@example.test`, données déjà enregistrées (« Résidence
Baobab »/« Lot 12 ») — aucune nouvelle donnée créée, registre CLAUDE.md
inchangé.**

- **Capture d'écran** : bande navy avec « K+ » or + « Residence
  Baobab », corps blanc (« Batiment A », « Lot 12 », bouton
  Actualiser), carte Progression avec barre remplie en or, icône
  neutre (gris), carte Dernier événement inchangée.
- **`getComputedStyle` (contre le DOM réellement rendu)** :
  - Bande navy : `background-color: rgb(11, 29, 58)` (`#0B1D3A` exact),
    `color: rgb(255, 255, 255)` (`#FFFFFF` exact).
  - Remplissage de la barre : `rgb(196, 154, 44)` (`#C49A2C` exact).
  - Repère « K+ » : `rgb(196, 154, 44)` (`#C49A2C` exact).
- **Contrôle de non-régression, BUILD (port 5174, compte
  `constructeur@example.test`)** : remplissage de `ProgressBar` sur
  « Tous les lots » toujours `rgb(52, 211, 153)` (`#34D399`, vert
  d'origine) — confirme que le défaut de `fillColor` reste inchangé
  hors HOME.

**Limite reconnue, pas contournée silencieusement** : le CTA « Voir
toutes mes actions » (navy plein) n'a PAS pu être capturé en écran
réel — aucune tâche en attente n'existe actuellement dans les données
de démo pour `demo.claude@example.test` (`GET /api/me/tasks/
?status=pending` vérifié vide), et le composant ne rend ce bouton que
si une tâche prioritaire existe. En créer une réelle passe par
`Task.reserve_opened`, généré de façon ASYNCHRONE via Celery
(`.delay()`) — `CELERY_TASK_ALWAYS_EAGER=False` en dev, aucun worker
Celery actif dans cet environnement (Redis/Docker indisponibles,
constaté). Faire tourner ce pipeline uniquement pour photographier un
bouton a été jugé disproportionné. Vérifié à la place par un test
unitaire dédié avec assertion de style exacte
(`toHaveStyle({ background: brandColors.navy, color: '#FFFFFF' })`,
`PriorityTaskSummary.test.tsx`) — et par confirmation visuelle que la
MÊME paire navy/blanc rend correctement dans ce navigateur (bande
`AppShell`, visible sur chaque capture d'écran de cette vérification).
Signalé explicitement, pas présenté comme une vérification complète.
- [ ] Toute nouvelle donnée de vérification (si nécessaire) ajoutée au
      registre centralisé CLAUDE.md.
