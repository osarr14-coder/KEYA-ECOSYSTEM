# Ticket F-041 — Consolidation des styles de tableau (packages/design-system)

## Statut

**Implémenté, testé, vérifié en navigateur réel, documenté.** Suites
`design-system` (98), `web` (180), `build` (77), `home` (58),
`control-pwa` (73) toutes vertes — 486 tests au total, `tsc --noEmit`
propre sur les 5 packages. Séquencement fichier par fichier respecté
(`LotLedgerPanel` → `PricingView` → `LegalPaymentTiersView` → `DevisView`
→ `AllLotsView`), chacun vérifié avec capture d'écran réelle +
`getComputedStyle()` avant de passer au suivant. **Une régression réelle
trouvée et corrigée pendant la vérification** (voir Notes) —
exactement ce que ce séquencement était censé prévenir.

## Origine

Revue manuelle de la plateforme (4 apps, tous rôles) : aucune app n'a de
traitement de tableau cohérent — pas de bordure d'en-tête distincte, pas
d'alignement des chiffres en colonne (`tabular-nums`), pas de survol de
ligne. Diagnostic initial trop rapide (« Back-office/Tarifs bruts » vs
« AllLotsView/DevisView déjà stylés ») — corrigé après audit réel : les 5
fichiers qui contiennent un `<table>` sur toute la plateforme
(`apps/web/src/views/{LotLedgerPanel,DevisView,PricingView,
LegalPaymentTiersView}.tsx`, `apps/build/src/views/AllLotsView.tsx` — HOME
et CONTROL PWA n'ont aucun tableau) ont TOUS déjà un style de cellule fait
main, mais **incohérent entre eux** :

| Vue | Padding cellule | Taille police | Bordure d'en-tête |
|---|---|---|---|
| `LotLedgerPanel` | `4px 8px` | `13px` en dur | **absente** |
| `DevisView` (tableau écarts) | `4px 8px` | `13px` en dur | présente |
| `DevisView` (tableau devis) | `10px 12px` | `14px` en dur | présente |
| `PricingView` | `4px 8px` | `14px` en dur | présente |
| `LegalPaymentTiersView` (×3 tableaux) | `4px 8px` / `10px 12px` / `4px` | `14px` en dur | présente |
| `AllLotsView` | `tokens.paddingBlock/paddingInline` (densité) | `tokens.fontSize` (densité) | présente, **mais seule la 1ʳᵉ colonne a un padding — les 6 autres colonnes n'en ont aucun** |

Ce qui donnait une impression de « brut » en tournant dans l'app, ce
n'était donc pas l'absence de style de tableau, mais l'absence
d'échelle typographique globale (hors scope de ce ticket, voir Hors
scope) combinée à cette incohérence de padding/police entre vues.

## Décisions de conception

**A. Option B retenue (consolidation), pas l'option purement additive.**
Un style inline gagne toujours sur une règle CSS générique pour les
propriétés qu'il définit — une règle `GlobalStyles` du type
`td { padding: ... }` serait donc silencieusement neutralisée sur ces 5
vues si leur style inline actuel restait en place. Seule la suppression
de ce style inline redondant permet un traitement réellement unifié.

**B. Unités `em`, relatives à la taille de police AMBIANTE (déjà posée
par le token de densité au niveau racine de chaque app)** — un seul jeu
de règles `GlobalStyles` s'adapte automatiquement aux 3 contextes déjà
définis (`dense` 13px, `confortable` 15px, CONTROL PWA 16px navigateur
par défaut, aucun système de densité), sans coordination JS
supplémentaire.

**C. Padding canonique : `0.3em 0.6em`** — choisi pour reproduire quasi
à l'identique la valeur déjà dominante (4 vues sur 5 utilisent `4px 8px`
ou son équivalent en token de densité, à 13px : `0.3em × 13px ≈ 3,9px`,
`0.6em × 13px ≈ 7,8px`, delta imperceptible). **Conséquence assumée** :
les 2 tableaux qui utilisaient `10px 12px` (`DevisView`, tableau devis
principal ; `LegalPaymentTiersView`, tableau historique de template) vont
visuellement SE RESSERRER pour rejoindre la famille dominante — cohérent
avec la doctrine « densité/vitesse de scan » des écrans professionnels
(CLAUDE.md, ticket 023), pas un effet de bord accidentel.

**D. Bordure d'en-tête plus marquée que la bordure de ligne** (`2px` vs
`1px`, même couleur `semanticColors.neutral.border`) — encode une vraie
distinction structurelle (en-tête vs donnée), qu'aucune des 5 vues ne
fait aujourd'hui (même poids de bordure partout). `LotLedgerPanel` gagne
ainsi une bordure d'en-tête qu'elle n'avait pas du tout — bénéfice direct
de la consolidation, pas seulement une suppression de redondance.

**E. `font-variant-numeric: tabular-nums` sur `td`** — aligne les
colonnes de chiffres (montants, pourcentages, jalons déclarés) dans les 5
vues, aucune ne le fait aujourd'hui.

**F. `tr:hover td { background: semanticColors.neutral.background }`**
(scope `tbody`, jamais l'en-tête) — pure addition, aucune des 5 vues n'a
de survol aujourd'hui, aucun conflit possible (pseudo-classe
inexprimable via un style inline statique).

**G. AllLotsView reçoit le MÊME traitement que les 4 autres vues**
(retrait du style inline redondant), **avec une vérification
supplémentaire propre à cette vue** : `<tr>` y porte une hauteur
explicite (`style={{height: tokens.rowHeight}}`, `32px` dense / `48px`
confortable) qui, elle, N'EST PAS touchée par ce ticket (spécifique à la
mise en page de cette vue, pas une règle de tableau générique). Le
padding `0.3em 0.6em` doit rester nettement inférieur à cette hauteur de
ligne dans les deux densités pour ne pas provoquer de dépassement visuel
— à confirmer par capture d'écran réelle dans les deux densités (voir
Séquencement, étape 5), pas supposé.

**H. Testabilité réelle dense/confortable — RÉELLEMENT possible, pas
seulement documentée comme limite.** Correction par rapport à
l'hypothèse initiale : `AppShell` est fixé à `density="dense"` dans
apps/web ET apps/build (`App.tsx`, prop statique), donc AUCUN tableau ne
change de densité via l'app-shell. **Mais `AllLotsView` a son PROPRE
bouton de densité local** (`role="group" aria-label="Densité du
tableau"`, boutons « Dense »/« Confortable », état React local
`density`/`setDensity`, indépendant de `AppShell`) — déjà visible dans le
DOM rendu réel en tournant dans BUILD. C'est donc LE cas concret demandé
au point 3 : le même tableau, dans le même écran, avec les deux
densités, atteignable par un simple clic. Vérifié en direct (voir
Séquencement, étape 5) plutôt que documenté comme non testable.

## Entités touchées

- `packages/design-system/src/components/GlobalStyles/GlobalStyles.tsx`
  — nouvelles règles `table`/`th`/`td`/`tbody tr:hover td`.
- `apps/web/src/views/LotLedgerPanel.tsx` — retrait du style inline
  redondant (`borderCollapse`, `fontSize`, padding cellule, bordure de
  ligne). `color: textMuted` sur les colonnes secondaires CONSERVÉ (pas
  générique, propre au contenu).
- `apps/web/src/views/PricingView.tsx` — idem.
- `apps/web/src/views/LegalPaymentTiersView.tsx` — idem, ×3 tableaux.
- `apps/web/src/views/DevisView.tsx` — idem, ×2 tableaux.
- `apps/build/src/views/AllLotsView.tsx` — idem, `tokens.rowHeight` sur
  `<tr>` CONSERVÉ (mise en page propre à la vue, pas une règle de
  tableau générique).
- Aucun fichier de test à modifier a priori — un seul `toHaveStyle` dans
  toute la plateforme concerne un tableau
  (`AllLotsView.test.tsx:97`, `expect(row).toHaveStyle({ height: '48px'
  })`), et il porte sur `tokens.rowHeight`, explicitement CONSERVÉ par ce
  ticket. Confirmé par grep sur les 5 fichiers de test AVANT ce ticket,
  pas une hypothèse.

## Scope inclus

- Consolidation des styles de tableau (bordure, padding, police,
  survol, alignement des chiffres) des 5 vues qui contiennent un
  `<table>`, sur une seule source de vérité (`GlobalStyles`).
- Correction de deux incohérences réelles trouvées pendant l'audit :
  bordure d'en-tête manquante (`LotLedgerPanel`), padding de cellule
  manquant sur 6 colonnes sur 7 (`AllLotsView`).

## Explicitement hors scope

- **Échelle typographique globale** (titres `h1`/`h2`/`h3`, libellés en
  majuscules) — proposée dans la même revue de plateforme, mais scindée
  en ticket séparé (candidat **F-042**) : modifier les marges de titre
  risque d'affecter la mise en page de bien plus d'écrans que les 5 vues
  à tableau, mérite sa propre vérification dédiée plutôt que d'être
  mélangée à ce changement-ci.
- **Toute modification de `semanticColors`** — palette déjà auditée
  (accessibilité AAA, ticket 024), non retouchée.
- **`tokens.rowHeight` (`AllLotsView`)** — reste piloté par la vue
  elle-même, jamais par `GlobalStyles`.
- **CONTROL PWA** — ne contient aucun `<table>`, rien à consolider.

## Séquencement (fichier par fichier, jamais un commit massif)

Backend + Postgres réutilisés tels quels (données de démo déjà seedées
cette session : Programme Almadies, Lots A1/B2, devis, tarifs Sénégal,
paliers légaux Sénégal, comptes `demo-admin@example.com`/
`constructeur-demo@example.com`, mot de passe `DemoPass123!`) — aucune
nouvelle donnée à créer. Méthode de vérification navigateur identique à
celle établie au ticket F-038 : capture d'écran réelle **et** inspection
`getComputedStyle()` réelle via `javascript_tool` (jamais seulement
l'arbre d'accessibilité ou l'extraction de texte) — les deux, pas l'un ou
l'autre, la capture ne prouve pas une valeur `em` résolue en pixels.

1. **`GlobalStyles.tsx`** — ajoute les nouvelles règles. Suite de tests
   `design-system` complète (97 tests) doit rester verte. `tsc --noEmit`
   propre.
2. **`LotLedgerPanel.tsx`** (apps/web) — retire le style inline
   redondant. Backend + `apps/web` démarrés, connexion `demo-admin`,
   écran grand-livre d'un lot verrouillé. Capture + `getComputedStyle()`
   sur un `<td>`/`<th>` réel : confirme padding ≈ 4/8px, bordure d'en-tête
   2px désormais présente (elle ne l'était pas avant ce ticket).
   Suite `web` (180 tests) verte avant de passer à l'étape suivante.
3. **`PricingView.tsx`** (apps/web) — même vérification, écran Tarifs
   (Sénégal). Suite `web` verte.
4. **`LegalPaymentTiersView.tsx`** (apps/web) — même vérification sur
   les 3 tableaux (template actif, historique, formulaire de création),
   écran Paliers légaux. Suite `web` verte.
5. **`DevisView.tsx`** (apps/web) — même vérification sur les 2
   tableaux ; capture AVANT/APRÈS du tableau devis principal pour
   documenter visuellement le resserrement `10px 12px` → `0.3em 0.6em`
   assumé en décision C. Suite `web` verte.
6. **`AllLotsView.tsx`** (apps/build) — retire le style inline
   redondant. Backend + `apps/build` démarrés, connexion
   `constructeur-demo`, écran « Tous les lots ». Vérification EN PLUS des
   4 précédentes, propre à cette vue (décisions G/H) :
   - Capture + `getComputedStyle()` en densité **Dense** (défaut) :
     confirme padding ≈ 4/8px sur TOUTES les colonnes (pas seulement la
     1ʳᵉ, correction du bug d'origine), hauteur de ligne toujours 32px,
     aucun dépassement visuel.
   - **Clic réel sur le bouton « Confortable »**, nouvelle capture +
     `getComputedStyle()` : confirme padding ≈ 4,5/9px (proportionnel à
     15px), hauteur de ligne 48px, toujours aucun dépassement — LA
     preuve concrète dense/confortable demandée, sur le même tableau,
     sans quitter l'écran.
   Suite `build` (17 tests) verte.
7. **Suite complète** (`design-system`/`web`/`build`/`home`/
   `control-pwa`, `tsc --noEmit` sur les 5 packages) — dernière passe
   avant de considérer le ticket terminé.

## Critères d'acceptation

- [x] `GlobalStyles` porte les nouvelles règles `table`/`th`/`td`/
      `tbody tr:hover td`, tests `design-system` verts (98, +3 dédiés).
- [x] Les 5 vues n'ont plus de style de tableau inline redondant avec
      `GlobalStyles` (bordure de ligne, padding générique, `border-collapse`)
      — le style inline restant (`color: textMuted`, `tokens.rowHeight` sur
      `AllLotsView`, `marginTop`/`marginBottom` propres à la mise en page)
      est du contenu ou de la mise en page, pas de la structure générique
      de tableau. **Exception assumée, trouvée en vérifiant les deux
      densités réelles** : `AllLotsView` GARDE `fontSize: tokens.fontSize`
      sur sa `<table>` — pas redondant pour cette vue précise (voir Notes),
      contrairement aux 4 autres vues où l'ambiant suffit.
- [x] Vérification navigateur réelle (capture + `getComputedStyle()`)
      pour CHACUNE des 5 vues, dans l'ordre du séquencement, suite de
      tests de la vue vérifiée verte avant de passer à la suivante.
- [x] `AllLotsView` vérifiée dans les DEUX densités réelles (clic sur le
      bouton « Confortable »), aucun dépassement de `tokens.rowHeight` —
      régression trouvée puis corrigée (voir Notes), re-vérifiée dans les
      deux densités après correctif.
- [x] Aucune régression sur `AllLotsView.test.tsx:97`
      (`toHaveStyle({ height: '48px' })`) — confirmé à chaque exécution de
      la suite `build` (17/17).
- [x] Suites complètes des 5 packages vertes (98+180+77+58+73 = 486
      tests), `tsc --noEmit` propre partout.
- [x] Documentation (ce fichier tenu à jour avec les résultats réels de
      vérification, section `CLAUDE.md`).

## Notes

**Régression réelle trouvée et corrigée pendant la vérification en deux
densités (étape 6, `AllLotsView`)** — exactement le scénario que le
séquencement fichier-par-fichier était censé prévenir. En retirant le
style inline jugé redondant, `fontSize: tokens.fontSize` a été retiré de
la `<table>` en assumant qu'il était couvert par la taille de police
AMBIANTE (comme pour les 4 autres vues, dont le contexte de densité est
figé par `AppShell`). Faux pour `AllLotsView` : cette vue a son PROPRE
bouton de densité local (`role="group" aria-label="Densité du tableau"`),
indépendant du `density="dense"` figé dans `apps/build/src/App.tsx`. Sans
ce `fontSize` explicite, le padding en `em` restait figé à la valeur
"dense" (3,9px/7,8px) même après un clic réel sur « Confortable » —
trouvé en comparant `getComputedStyle()` AVANT/APRÈS le clic (padding
identique, alors que `tokens.rowHeight` sur `<tr>`, lui, changeait bien de
32px à 48px). Corrigé en restaurant `style={{ fontSize: tokens.fontSize }}`
sur la `<table>`, puis re-vérifié dans les DEUX densités : Dense
(13px, padding 3,9px/7,8px, ligne 32px) et Confortable (15px, padding
4,5px/9px, ligne 48px), aucun dépassement dans les deux cas. Suite
`build` toujours verte (17/17, y compris `toHaveStyle({height:'48px'})`)
après le correctif.

**Bug d'origine confirmé corrigé** : `AllLotsView` n'avait auparavant de
padding explicite QUE sur la 1ʳᵉ colonne (`Nom`) — les 6 autres
(`Bien`/`Programme`/.../`Réserves ouvertes`) n'en avaient aucun. Vérifié
en direct : les 7 colonnes affichent désormais le même padding, dans les
deux densités.

**Bordure d'en-tête, quirk de mesure sous `border-collapse: collapse`** —
`getComputedStyle().borderBottomWidth` rapporte des valeurs sous-pixel
(`1,667px` pour l'en-tête au lieu de `2px` nominal, `0,833px` pour une
ligne au lieu de `1px`) plutôt que les valeurs CSS déclarées, un
comportement de résolution de bordures fusionnées propre au moteur de
rendu, pas un défaut de ce ticket — le ratio observé (~2:1) confirme
néanmoins que la distinction en-tête/ligne (décision D) fonctionne
réellement.

**Données de vérification créées, pas seulement réutilisées** — les 2
lots de démo existants (A1/B2 Almadies) avaient déjà chacun un
`LotLedger` créé lors de sessions précédentes, donc plus JOIGNABLES via
l'écran Devis (limite résiduelle F-036, documentée séparément) : aucune
donnée réelle avec charges BC n'était donc atteignable pour vérifier
`LotLedgerPanel`/`DevisView` en l'état. Un nouveau lot (« Lot Verif
F-041 », Programme Almadies, Sponsor Villa Almadies) a été créé via les
VRAIES fonctions de service backend (`create_devis`, `lock_devis`,
`create_work_declaration`, `create_mission` — jamais une insertion SQL
brute), ce qui a déclenché `record_bc_charge_for_mission` (B-036)
naturellement et produit une charge BC réelle (150 000, forfait global,
jalon foncier) — la table `LotBcChargesPanel` a donc pu être vérifiée
avec des données réelles, pas seulement son état vide. Ce lot reste en
base (nommage explicitement distinct des données de démo « Almadies »),
aucune suppression effectuée par prudence (chaîne d'objets liés :
`InspectionMission`/`WorkDeclaration`/`TrustEvent`/`LotBcCharge`).

Ticket rédigé sans implémentation préalable, à la demande explicite de
l'utilisateur, vu l'ampleur du changement (5 vues + design-system) —
même discipline que F-038/F-039. Séquencement fichier par fichier
respecté à la lettre, feu vert confirmé avant implémentation.
