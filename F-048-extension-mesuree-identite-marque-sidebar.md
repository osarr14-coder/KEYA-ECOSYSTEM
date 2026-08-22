# Ticket F-048 — Extension mesurée de l'identité de marque au bloc supérieur de la sidebar (AppShell)

## Statut

**Implémenté, testé, vérifié en navigateur réel sur les 3 apps
concernées. Terminé.** Décisions A-F confirmées par l'utilisateur
avant tout code. Suite complète verte (518 tests sur les 5 packages),
`tsc --noEmit` propre, `brandGovernance.test.ts` toujours vert
(`FORBIDDEN_COMPONENT_DIRS` inchangée), `levelMeta.ts` intouché.

## Origine

Demande explicite de l'utilisateur : révision **consciente et
limitée** de la doctrine « `brandColors` réservé à HOME uniquement »
(17.3 V3.0, cadrages F-039/F-046) — motivée par un besoin réel de
crédibilité institutionnelle pour les professionnels externes
(constructeurs, bureaux de contrôle, banques) qui découvrent KEYIMMO
via BUILD/CONTROL sans jamais passer par HOME.

**Explicitement PAS un retour au ticket F-047** (rejeté, hors mandat,
voir `F-047-enrichissement-visuel-toute-plateforme.md`) — périmètre
strictement plus restreint.

Référence visuelle validée par l'utilisateur :
- Bloc supérieur de la sidebar `AppShell` (logo K+toit + « KEYIMMO
  AFRIC » + nom de l'app) en navy plein (`#0B1D3A`) — zone permanente,
  visible en toute circonstance, sur les 4 apps (HOME, BUILD, CONTROL
  PWA, apps/web).
- Onglet/lien de navigation actif dans la sidebar : bordure gauche or
  (`#C49A2C`) + léger rehaussement de fond.
- Tout le reste (liste de navigation au repos, contenu de travail,
  tableaux, badges de statut sémantiques) reste strictement neutre,
  inchangé.

## Hors scope, explicitement (contrairement à F-047 rejeté)

- `TabBar` ne prend aucune teinte de marque.
- `Card` ne gagne aucune variante `tone="brand"`.
- Aucune teinte de fond de page.
- CONTROL PWA : à évaluer séparément si un équivalent est pertinent
  vu l'absence actuelle d'`AppShell` — ne pas improviser de solution,
  demander confirmation si le cas se présente pendant l'audit.

## Rappel non négociable — `brandGovernance.test.ts`

Doit être **ÉLARGI** pour autoriser ce point de contact précis (bloc
logo + accent actif dans `AppShell`), **jamais démantelé ni affaibli
au-delà de ce point précis** — sa fonction de garde-fou doit rester
intacte pour tout le reste (`TabBar`, `Card`, `StatusBadge`/
`levelMeta.ts` restent protégés comme avant).

## Confirmé par l'utilisateur

**Emplacement** : le bloc navy est un NOUVEAU bloc en haut de la
colonne `<aside>` (sidebar verticale) — le bandeau `<header>`
horizontal posé par F-039 (gated par `brand`, actuellement HOME
uniquement) **reste inchangé, intouché, coexiste tel quel**. Les deux
zones navy peuvent cohabiter (HOME les aura toutes les deux ; BUILD/
apps/web n'auront que la nouvelle zone sidebar, jamais le bandeau
`<header>` — `brand` n'est pas étendu par ce ticket).

## Audit — état réel d'`AppShell.tsx` (confirmé par lecture directe)

- `<aside>` : aucun fond coloré aujourd'hui, juste une bordure droite
  grise ; contient le bouton de repli puis `<nav><ul>` (items de
  module). Rien en haut de cette colonne actuellement.
- Item de navigation actif : `borderLeft: 3px solid
  semanticColors.neutral.text` (encre), fond
  `semanticColors.neutral.background` (gris très clair, léger
  rehaussement DÉJÀ existant), texte `neutral.text`. Rien à voir avec
  `brandColors` aujourd'hui.
- Bandeau `<header>` (F-039) : navy plein UNIQUEMENT si `brand=true` —
  aujourd'hui seul `apps/home/src/App.tsx` le passe ; `apps/build` et
  `apps/web` ne le passent jamais.
- `brandGovernance.test.ts` : `AppShell` est DÉJÀ hors de la liste
  surveillée (`FORBIDDEN_COMPONENT_DIRS`), avec un contrôle positif
  qui vérifie déjà qu'il référence `brandColors`. Rien à changer dans
  le MÉCANISME (aucune liste à modifier) — mais le commentaire
  d'en-tête du fichier (« seule la variante HOME d'AppShell... »)
  devient FAUX une fois ce ticket livré (le bloc sidebar est universel,
  pas HOME-only) : à corriger pour rester une documentation exacte.
- **Point de compatibilité trouvé** : le test existant
  (`AppShell.test.tsx`, « avec brand : en-tête en navy... ») fait
  `screen.getByText('KEYIMMO AFRIC')` SANS le scoper au bandeau
  `<header>`. Une fois le nouveau bloc sidebar en place (qui affichera
  aussi ce texte, TOUJOURS, indépendamment de `brand`), cette requête
  deviendrait ambiguë (deux éléments correspondants quand `brand=true`)
  et le test échouerait — pas une régression du comportement réel, un
  effet mécanique attendu de la duplication volontaire du texte. À
  corriger en scopant la requête au `<header>` (`within(header)`).
- Aucun `appLabel`/équivalent « nom de l'app » n'existe aujourd'hui
  dans `AppShellProps` — à ajouter.

## Décisions proposées

**A. Nouveau bloc navy, TOUJOURS rendu (aucun prop de gate)** — en
haut de `<aside>`, avant le bouton de repli. Contenu : repère « K+ »
(or, même traitement que le bandeau `<header>` existant) + « KEYIMMO
AFRIC » (blanc, gras) + `appLabel` (nouvelle prop optionnelle,
`string`, ligne secondaire discrète — `rgba(255,255,255,0.72)`, taille
`0.85em`). `data-testid="sidebar-brand-block"` — **distinct** de
`data-testid="brand-mark"` (déjà utilisé par le bandeau `<header>`,
jamais réutilisé pour ce nouveau bloc, pour ne pas casser la
distinction entre les deux zones dans les tests).

**B. `appLabel` optionnelle, pas requise** — si absente, seule la
ligne « KEYIMMO AFRIC » s'affiche (pas de ligne vide). Optionnelle
plutôt que requise : évite une mise à jour mécanique des ~15 appels
`<AppShell>` déjà existants dans `AppShell.test.tsx` qui n'ont pas
besoin de cette valeur pour ce qu'ils testent — cohérent avec le
pattern déjà établi du composant (`brand?`, `icon?`, tous optionnels).

**C. Mode replié (`collapsed`, 56px)** — affiche seulement « K+ »
centré, masque « KEYIMMO AFRIC » et `appLabel` — même principe déjà
appliqué aux items de navigation repliés (icône seule).

**D. Item actif — SEULE la couleur de la bordure gauche change**
(`brandColors.gold` au lieu de `neutral.text`) — fond
(`semanticColors.neutral.background`) et couleur de texte
(`neutral.text`) restent EXACTEMENT ceux d'aujourd'hui. **Confirmé par
l'utilisateur.**

**E. `appLabel` par app — confirmé, ajusté par l'utilisateur** :
`apps/home` → « Accueil » ; `apps/build` → « BUILD » ; `apps/web` →
**« KEYIMMO »** (pas « Back-office », pour éviter la redite avec le
libellé d'onglet de navigation déjà présent dans la même sidebar).

**F. `brandGovernance.test.ts`** : commentaire d'en-tête corrigé pour
refléter que le bloc sidebar d'`AppShell` est désormais universel
(pas HOME-only) — **aucun changement à `FORBIDDEN_COMPONENT_DIRS`**
(toujours zéro tolérance pour `TabBar`/`Card`/`StatusBadge`/etc.).
`AppShell.test.tsx` gagne de nouvelles assertions NÉGATIVES
explicites (le bloc `<main>`/le contenu de travail/les items de nav
INACTIFS ne reçoivent JAMAIS `brandColors`) — c'est ÇA, concrètement,
qui « élargit sans affaiblir » : le point d'exception existant
(`AppShell`) devient mieux borné par des tests de comportement rendu,
pas moins surveillé.

## CONTROL PWA — pas de décision, conforme à la demande

Explicitement PAS traité dans ce ticket — n'utilise pas `AppShell`
(confirmé, absence intouchée par ce ticket, layout tactile dédié). Si
un traitement équivalent est souhaité, ce sera une décision séparée,
sur demande explicite.

## Scope définitif

- `packages/design-system/src/components/AppShell/AppShell.tsx` (+
  test) — nouveau bloc sidebar (Décisions A/B/C), couleur de bordure
  de l'item actif (Décision D).
- `packages/design-system/src/brandGovernance.test.ts` — commentaire
  d'en-tête corrigé (Décision F), **zéro changement à
  `FORBIDDEN_COMPONENT_DIRS`**.
- `apps/home/src/App.tsx`, `apps/build/src/App.tsx`,
  `apps/web/src/App.tsx` — passage de la nouvelle prop `appLabel`
  (Décision E).
- `CLAUDE.md` — nouvelle section ticket F-048, note explicite que la
  doctrine 17.3 est révisée de façon LIMITÉE et PRÉCISE (ce point de
  contact seul), pas abandonnée (contrairement à ce que F-047 avait
  proposé et qui a été rejeté).

## Hors scope (rappel)

- `TabBar`, `Card` (aucune variante `tone="brand"`), fond de page —
  aucun changé par ce ticket.
- CONTROL PWA — non traité (voir section dédiée ci-dessus).
- Le bandeau `<header>` existant (F-039, `brand` prop) — intouché,
  reste HOME-only exactement comme avant.
- Toute nouvelle couleur — seules `brandColors.navy`/`.gold`
  existantes sont utilisées.

## Critères d'acceptation

- [x] Bloc navy en haut de la sidebar `AppShell`, TOUJOURS visible
      (indépendant de `brand`), sur les 3 apps qui utilisent
      `AppShell` (HOME/BUILD/web).
- [x] Item de navigation actif : bordure gauche or, reste du
      traitement (fond/texte) inchangé.
- [x] Mode replié : bloc réduit à « K+ » seul, centré.
- [x] `brandGovernance.test.ts` toujours vert, `FORBIDDEN_COMPONENT_DIRS`
      inchangée ; nouvelles assertions négatives dans
      `AppShell.test.tsx` prouvant que `<main>`/items inactifs ne
      reçoivent jamais `brandColors`.
- [x] `levelMeta.ts` intouché (`git diff` vide).
- [x] Zéro régression : suite complète des 5 packages verte (baseline
      avant ticket : 511 tests), `tsc --noEmit` propre.
- [x] Vérification visuelle réelle (capture d'écran + `getComputedStyle`)
      sur les 3 apps concernées (HOME/BUILD/web) avant de considérer
      le ticket terminé.

## Vérification visuelle réelle

**Backend + HOME (5173)/BUILD (5174)/apps-web (5176) démarrés,
comptes `demo.claude@example.test`/`constructeur@example.test`/
`admin.keyimmo@example.test`, données déjà enregistrées — aucune
nouvelle donnée créée, registre CLAUDE.md inchangé.**

- **`apps/web`** : bloc navy sidebar (« K+ KEYIMMO AFRIC » / « KEYIMMO »)
  + « Back-office » actif avec bordure or, bandeau `<header>` neutre
  (transparent) comme attendu (`brand` non activé ici).
- **HOME** : bloc navy sidebar ET bandeau `<header>` navy (F-039)
  cohabitent, tous deux affichent « K+ KEYIMMO AFRIC » — cohabitation
  volontaire confirmée par l'utilisateur avant implémentation.
  « Accueil » actif avec bordure or.
- **BUILD** : bloc navy sidebar (appLabel « BUILD ») + bandeau
  `<header>` neutre. « BUILD » actif avec bordure or.
- **`getComputedStyle` (contre le DOM réel, `apps/web`)** :
  - Bloc sidebar : `background-color: rgb(11, 29, 58)` (`#0B1D3A`
    exact), `color: rgb(255, 255, 255)` exact.
  - « K+ » : `rgb(196, 154, 44)` (`#C49A2C` exact).
  - Bordure de l'item actif : `border-left-color: rgb(196, 154, 44)`
    exact.
  - Fond de l'item actif : `rgb(249, 250, 251)` (`#F9FAFB`,
    `semanticColors.neutral.background` — **inchangé**, confirme la
    décision D : seule la bordure a changé de couleur).
  - Bandeau `<header>` : `background-color: rgba(0, 0, 0, 0)`
    (transparent — confirme que `brand` reste non activé sur cette
    app, comportement F-039 intouché).

## Prochaine étape

Aucune — ticket terminé.
