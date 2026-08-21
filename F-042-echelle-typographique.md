# Ticket F-042 — Échelle typographique (packages/design-system)

## Statut

**Implémenté, testé, vérifié en navigateur réel dans les 3 contextes de
densité, documenté.** Suite `design-system` (100 tests, +2 dédiés),
`tsc --noEmit` propre sur les 5 packages. Scindé de F-041 (« hors scope »)
pour ne pas mélanger deux profils de risque différents dans un seul
changement.

## Origine

F-041 avait consolidé les styles de tableau mais explicitement laissé de
côté l'échelle de titres (`h1`-`h6`), en signalant le risque : « modifier
les marges de titre risque d'affecter la mise en page de bien plus
d'écrans que les 5 vues à tableau ». Ce ticket reprend ce chantier,
strictement scopé aux **tailles** de titre (jamais aux marges — voir
Décisions), après un inventaire réel plutôt qu'une échelle inventée.

## Inventaire réel (grep `<h1>` à `<h6>`, 4 apps, avant toute conception)

| Niveau | web | home | build | control-pwa | Total |
|---|---|---|---|---|---|
| h1 | 1 (écran connexion, hors `AppShell`) | 1 (`OverviewView`) | 0 | 2 (`MissionsListView`, `InspectionFormView`) | 4 |
| h2 | 3 | 2 | 5 | 0 | 10 |
| h3 | 8 | 0 | 0 | 0 | 8 |
| h4 | 3 | 0 | 0 | 0 | 3 |
| h5/h6 | 0 | 0 | 0 | 0 | 0 |

**h3/h4 : utilisés réellement (donc une règle est conçue pour eux), mais
UNIQUEMENT dans apps/web (densité dense, 13px)** — vérifiables seulement
à cette densité ; aucune valeur « confortable »/« CONTROL » n'a été
inventée ou vérifiée pour ces deux niveaux, faute d'écran réel où les
observer. **h5/h6 : non applicable actuellement**, aucune règle créée.

**Trois contextes de densité ambiante réels, pas deux** (confirmé en
lisant `App.tsx` des 4 apps, pas supposé) :
- **13px (dense)** — apps/web authentifié (`AppShell density="dense"`),
  apps/build.
- **15px (confortable)** — apps/home (`AppShell density="confortable"`).
- **16px (aucun système de densité)** — l'écran de connexion d'apps/web
  (`<h1>` hors `AppShell`, `<main>` sans `fontSize` explicite) **et**
  CONTROL PWA (pas d'`AppShell` du tout) : deux contextes distincts qui
  aboutissent au même défaut navigateur.

## État réel de `th` posé par F-041 (vérifié avant conception)

```
th { text-align: left; padding: 0.3em 0.6em; border-bottom: 2px solid neutral.border; }
```

Ni `font-size`, ni `font-weight`, ni `color`. **Décision : étendre ce
MÊME bloc, jamais créer un second `th { ... }` ailleurs dans
`GlobalStyles`** — une seule règle gouverne chaque propriété de `th` de
bout en bout, structure (F-041) et typographie (F-042) confondues.
Vérifié après implémentation : `css.match(/th\s*\{[^}]*\}/g)` ne trouve
qu'UN SEUL bloc dans toute la feuille de style (test dédié).

## Décisions de conception

**A. Tailles en unités `em`, jamais en `px` figé** — relatif à la taille
de police AMBIANTE déjà posée par le token de densité (même mécanisme
que F-041) : un seul jeu de règles couvre les 3 contextes sans
coordination JS.

**B. Barème retenu** :

| Niveau | `em` | Poids | Dense 13px | Confortable 15px | 16px |
|---|---|---|---|---|---|
| h1 | 1.75em | 700 | 22.75px | 26.25px | 28px |
| h2 | 1.35em | 700 | 17.55px | 20.25px | 21.6px |
| h3 | 1.1em | 600 | 14.3px | *(jamais utilisé ici)* | *(jamais utilisé ici)* |
| h4 | 1em | 600 | 13px | *(jamais utilisé ici)* | *(jamais utilisé ici)* |
| `th` (étend F-041) | 0.85em | 500, couleur `textMuted` | 11.05px | 12.75px | 13.6px |

**C. `margin` volontairement ABSENT de ces règles** — la plupart des
titres portent déjà leur propre marge inline
(`marginTop`/`marginBottom`/`margin`) ; la retirer risquerait une
régression de mise en page sur des écrans hors du périmètre de ce
ticket, exactement le risque signalé par F-041. Seuls `font-size`,
`font-weight`, `line-height`, `text-wrap: balance` sont posés.

**D. h4 à `1em` (pas `<1em`)** — un h4 plus petit que le texte qu'il
introduit (ex. juste au-dessus d'un tableau, dont les cellules sont à
`1em` depuis F-041) lirait à l'envers. Distingué par le poids (600) et
`text-wrap: balance`, jamais par une taille réduite.

**E. `th` à 0.85em reste plus petit que `1em` (texte de donnée) à CHAQUE
densité, par construction** — les deux étant des multiples de la même
taille ambiante, leur ratio (85 %) ne varie jamais. Vérifié malgré tout
en direct (pas seulement déduit) : à 13px, 11,05px vs 13px ; à 16px
(le cas limite explicitement demandé), 13,6px vs 16px — toujours
nettement plus petit, jamais disproportionné.

## Vérification en navigateur réel (capture + `getComputedStyle()`)

Backend + les 4 apps démarrés (données de démo réutilisées, y compris
« Lot Verif F-041 », toujours indélébile par conception — voir
CLAUDE.md).

- **h1, 16px** (écran de connexion, apps/web) : `28px` / `700`
  (`1.75 × 16`). Confirmé identique sur CONTROL PWA (`MissionsListView`
  « Mes missions » : `28px`/`700`) et sur `InspectionFormView` (titre
  sur 2 lignes, `text-wrap: balance` confirmé actif —
  `getComputedStyle().textWrap === 'balance'`).
- **h2, 13px** (`BackofficeView`, apps/web) : `17.55px` / `700`
  (`1.35 × 13`). Confirmé identique sur `ExceptionsView` (apps/build,
  même densité, autre app) : `17.55px`/`700`.
- **h3, 13px** (`PricingView`, « Taux actuels ») : `14.3px` / `600`
  (`1.1 × 13`).
- **h1/h2, 15px** (`OverviewView`, apps/home) : h1 « Residence Almadies »
  `26.25px`/`700` (`1.75 × 15`) ; h2 « Dernier événement » `20.25px`/`700`
  (`1.35 × 15`).
- **Cohérence F-041 + F-042 sur `LotLedgerPanel`** (demandée
  explicitement avant de considérer le ticket terminé) : table « Charges
  bureau de contrôle » (bordure d'en-tête posée par F-041), vérifiée avec
  son h4 voisin —
  - h4 « Charges bureau de contrôle » : `13px`/`600`/encre
    (`rgb(17,24,39)`).
  - `th` (« Jalon »/« Montant »/« Type ») : `11.05px`/`500`/muted
    (`rgb(75,85,99)`), bordure d'en-tête F-041 toujours présente
    (`1,667px solid`, quirk de rendu déjà documenté au ticket F-041, pas
    un nouveau problème).
  - `td` (données) : `13px`/`400`/encre.
  Hiérarchie confirmée cohérente : h4 (heading) > `td` (donnée) > `th`
  (libellé, le plus petit ET le plus atténué) — les deux règles
  produisent un rendu unique, pas deux traitements qui se contredisent.

## Entités touchées

- `packages/design-system/src/components/GlobalStyles/GlobalStyles.tsx`
  — règles `h1`-`h4` ajoutées ; bloc `th` existant (F-041) étendu avec
  `font-size`/`font-weight`/`color`, jamais dupliqué.
- `packages/design-system/src/components/GlobalStyles/GlobalStyles.test.tsx`
  — 2 tests dédiés (échelle en `em` + absence de `h5`/`h6`, unicité du
  bloc `th`).

## Scope inclus

- Échelle `h1`-`h4` en `em`, relative à la densité ambiante.
- Extension (jamais duplication) du bloc `th` de F-041 avec la
  typographie de libellé de colonne.
- Vérification réelle dans les 3 densités pour h1/h2 (seuls niveaux
  utilisés partout), dans le seul contexte réel pour h3/h4 (apps/web
  dense uniquement).

## Explicitement hors scope

- **`margin` des titres** — voir décision C, risque de régression de
  mise en page non vérifié pour ce ticket.
- **h5/h6** — non applicable actuellement, aucune règle créée ; à
  concevoir si un jour réellement utilisé, jamais avant.
- **Toute modification de `semanticColors`** — `textMuted` réutilisé tel
  quel (déjà audité, ticket 024).

## Critères d'acceptation

- [x] Inventaire réel (`grep`) effectué AVANT toute valeur choisie —
      documenté ci-dessus, aucun niveau non testable inventé.
- [x] Tailles en `em`, jamais en `px` figé.
- [x] `th` étend le MÊME bloc que F-041, une seule règle par propriété
      (vérifié par test dédié : un seul bloc `th` dans toute la feuille).
- [x] Libellés de colonne vérifiés plus petits que le texte environnant
      aux 3 densités, y compris 16px (le cas limite demandé).
- [x] Cohérence F-041 + F-042 vérifiée en direct sur un tableau qui avait
      DÉJÀ la bordure d'en-tête F-041 (`LotLedgerPanel`), avant de
      considérer le ticket terminé — pas seulement chaque règle isolée.
- [x] h1/h2 vérifiés dans les 3 densités réelles ; h3/h4 vérifiés dans
      leur seul contexte réel (dense), aucune valeur confortable/CONTROL
      inventée pour eux.
- [x] Suite `design-system` verte (100 tests), suites des 4 apps vertes
      (aucune régression, `GlobalStyles` est le seul fichier touché),
      `tsc --noEmit` propre sur les 5 packages.
- [x] Documentation (ce fichier + section `CLAUDE.md`).

## Notes

Deux erreurs de syntaxe corrigées pendant l'implémentation (accents
graves à l'intérieur des commentaires du littéral de gabarit `GLOBAL_CSS`
— même piège qu'au ticket F-041, cette fois répété deux fois de suite
avant d'être vraiment évité) : tout texte de commentaire à l'intérieur de
ce fichier doit rester exempt d'accents graves, quel que soit le ticket.

Séquencement demandé par l'utilisateur respecté à la lettre : inventaire
réel avant conception, vérification de l'état existant de `th` avant
d'y toucher, barème en `em` plutôt qu'en `px`, vérification aux 3
densités (pas une seule), cohérence F-041/F-042 démontrée sur un cas
réel avant de considérer le ticket terminé.
