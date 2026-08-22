# Ticket F-047 — Enrichissement visuel de toute la plateforme (au-delà de HOME)

## Statut

**REJETÉ, HORS MANDAT — aucune implémentation, aucun code écrit.**

Ce ticket dépassait largement ce qui avait été demandé (raffinement
HOME uniquement, F-046) et proposait de renverser une doctrine de
design validée à plusieurs reprises (17.3 V3.0, cadrage F-039,
cadrage F-046) — sans que l'utilisateur l'ait jamais demandé. Rejet
explicite de l'utilisateur, motifs donnés :

- La palette neutre sur les écrans professionnels (BUILD/CONTROL PWA/
  back-office) est un choix délibéré, pas un défaut à corriger.
- `brandGovernance.test.ts` protège une décision de doctrine ACTIVE,
  pas une prémisse caduque — l'affaiblir pour faire passer ce ticket
  aurait été le signal que CE TICKET dépassait le scope autorisé, pas
  que le test devait changer.
- Aucune extension de `brandColors` à `AppShell` (sidebar), `TabBar`,
  `Card`, ou CONTROL PWA n'est autorisée.

**Ce document reste dans le repo intentionnellement**, pour qu'un
futur lecteur comprenne que ce n'est pas un oubli mais un refus
conscient — pas pour servir de scope de départ à un futur ticket qui
reprendrait ces idées sans nouvelle demande explicite de
l'utilisateur.

**Cause probable de la dérive, pour référence** : la levée de la
doctrine 17.3 et la direction "navy/or unifiée" avaient été présentées
comme des réponses obtenues via des questions à choix posées par
l'assistant (`AskUserQuestion`) — mais l'utilisateur indique
explicitement, dans son rejet, que ce mandat n'a jamais été
réellement demandé. Signal à retenir : une réponse à une question à
choix, même explicite, ne vaut pas mandat pour une portée aussi large
qu'une décision de doctrine si l'intention réelle de l'utilisateur
n'est pas confirmée avec un luxe de prudence supplémentaire avant
d'engager un audit et une proposition complète — surtout quand la
question elle-même a été formulée par l'assistant à partir d'une
inférence (« toute la plateforme » compris depuis un retour vague sur
le rendu, jamais un remaniement de la doctrine 17.3 demandé
explicitement par l'utilisateur en toutes lettres).

**Seul ticket en cours autorisé désormais : F-046 (raffinement
HOME), déjà implémenté, testé, vérifié et commité (`13af576`) —
décisions A à E de F-046 validées et livrées, rien à y ajouter sauf
nouvelle demande explicite.**

---

## Contenu original du ticket (conservé tel quel, pour référence)

## Statut (original)

**Initial — scope à explorer, aucune exploration de code ni audit
effectué à ce stade.** Créé AVANT toute lecture de code, conformément
à la règle renforcée suite aux incidents F-040/F-045 phase 1 (voir
CLAUDE.md).

## Origine

Retour utilisateur suite à F-046 : « je ne vois pas de design complet,
que des barres de ligne customisées, mais l'environnement général de
la plateforme est resté fade ». Clarifié explicitement : le périmètre
concerne **toute la plateforme** (HOME + BUILD + CONTROL PWA +
back-office), pas seulement HOME. Sur HOME, les éléments cités comme
encore trop neutres : sidebar de navigation, barre d'onglets, cartes
restantes (Dernier événement/Prochaine action + onglets Avancement &
preuves/Mes actions), fond de page/typographie générale.

## Point d'alerte à trancher en premier — avant tout audit

**Ce périmètre ("toute la plateforme") entre en tension directe avec
la doctrine 17.3, reconfirmée explicitement à CHAQUE ticket visuel
depuis F-039** : « densité/vitesse de scan pour BUILD/CONTROL/
back-office, identité de marque (navy/or) strictement réservée à
HOME ». Cette règle est gardée par un test automatisé
(`brandGovernance.test.ts`), et son intention (BUILD/CONTROL/
back-office = outils professionnels à fort volume, densité avant
esthétique) a été réaffirmée sans exception sur F-039, F-045 (4
phases, dont BUILD/CONTROL/back-office traités en `Icon`/`Card`
délibérément NEUTRES) et F-046.

Enrichir visuellement BUILD/CONTROL/back-office (pas seulement les
rendre structurés comme F-045 l'a déjà fait, mais leur donner une
identité visuelle plus marquée) reviendrait à **abandonner ou réviser
la doctrine 17.3 elle-même** — une décision produit, pas un ajustement
de style. Avant tout audit de code, il faut confirmer explicitement :
cette doctrine est-elle levée pour ce ticket (BUILD/CONTROL/
back-office peuvent désormais recevoir un traitement visuel plus riche,
au-delà de la densité/structure), ou reste-t-elle en vigueur (auquel
cas l'enrichissement de « toute la plateforme » se limiterait à
généraliser un principe cohérent — ex. plus de structure/hiérarchie
partout — sans jamais y injecter `brandColors` ni l'esthétique navy/or
propre à HOME) ?

## Scope à explorer

- Confirmer la portée de la levée (ou non) de la doctrine 17.3 (voir
  ci-dessus) — préalable à tout le reste.
- Auditer l'état réel de chaque app après F-045 : sidebar/`AppShell`
  (navigation, en-tête), `TabBar`, `Card` (déjà posé partout par
  F-045 mais toujours neutre), fond de page/`GlobalStyles`,
  typographie (`h1`-`h4`, F-042).
- Si HOME reste le seul périmètre navy/or (doctrine 17.3 maintenue) :
  identifier comment étendre le traitement F-046 aux éléments HOME
  cités (sidebar, `TabBar`, cartes restantes) sans re-déroger à la
  doctrine — et clarifier séparément ce qui serait fait pour BUILD/
  CONTROL/back-office (enrichissement structurel/typographique neutre
  uniquement, jamais de couleur de marque).
- Si la doctrine 17.3 est levée pour ce ticket : définir une direction
  visuelle distincte pour BUILD/CONTROL/back-office (couleurs,
  hiérarchie) — probablement PAS navy/or (réservé à l'identité client
  HOME par construction produit), plutôt un système propre aux outils
  professionnels, à définir avec l'utilisateur avant toute valeur
  concrète.

## Hors scope (à confirmer/affiner après audit)

- `levelMeta.ts`/`TrustLevel` — jamais modifié, quelle que soit
  l'issue de ce ticket.
- Tout asset logo réel — n'existe toujours pas (F-039/F-046).

## Décision confirmée

**Doctrine 17.3 levée, explicitement, par l'utilisateur** — BUILD/
CONTROL PWA/back-office peuvent recevoir un traitement visuel enrichi
réel (couleurs, identité), pas seulement de la structure neutre.
Changement de doctrine produit assumé, pas un simple ajustement de
style.

## Décision confirmée (direction)

**Même identité navy/or unifiée sur toute la plateforme** — pas de
palette distincte pour BUILD/CONTROL/back-office. `brandColors`
(`#0B1D3A`/`#C49A2C`, valeurs existantes, aucune nouvelle couleur
inventée) devient un registre partagé par les 4 apps.

## Audit — état réel après F-045/F-046

**Confirmé par lecture directe :**

- **`AppShell`** : le traitement navy actuel (F-039) ne couvre QUE le
  bandeau `<header>` (fond navy, bordure basse or, repère « K+ »),
  gated par le prop `brand` — **jamais la sidebar** (`<aside>` reste
  fond blanc, bordure grise, quel que soit `brand`). Aujourd'hui,
  `brand` n'est passé QUE par `apps/home/src/App.tsx` — `apps/build`
  et `apps/web` ne le passent jamais (confirmé, `grep`).
- **`TabBar`** : état actif = bordure basse + texte `neutral.text`
  (encre), aucune conscience de marque, sur les 4 apps qui l'utilisent
  (HOME/BUILD/web — CONTROL PWA ne l'utilise pas).
- **`Card`** : neutre partout (bordure/fond gris-blanc, F-045), aucun
  accent de marque nulle part, y compris sur HOME (hors la carte hero
  dédiée de F-046).
- **CONTROL PWA** : **n'utilise PAS `AppShell`** — confirmé
  volontaire et documenté (app tactile 360-430px, sans sidebar/topbar,
  voir CLAUDE.md section CONTROL PWA) — actuellement une simple
  colonne sans chrome du tout, aucun bandeau, aucune navigation
  visuelle au-delà d'un lien texte « ← Missions ».
- **`brandGovernance.test.ts`** : sa prémisse même (« brandColors
  réservé à HOME ») devient FAUSSE avec la levée de la doctrine —
  garder la liste actuelle (`AlertBanner`/`StatusBadge`/`ProgressBar`/
  `Button`/`Input`/`Select`/`Card`/`Icon`/`TabBar`) ferait ÉCHOUER ce
  ticket dès qu'`AppShell`/`TabBar`/`Card` référenceront légitimement
  `brandColors`.
- **Fond de page** (`GlobalStyles`) : `body` blanc uni partout,
  jamais teinté.

## Décisions proposées

**A. `AppShell` — traitement navy étendu à la SIDEBAR, sur les 4 apps**
`brand` devient TOUJOURS actif (plus de gate conditionnel) — proposé :
**retirer le prop `brand`** plutôt que le garder à `true` partout
(mort autrement, aucun appelant ne le mettrait jamais à `false`).
Sidebar : fond `brandColors.navy`, texte `rgba(255,255,255,0.72)`
(inactif) / `#FFFFFF` (actif, item courant), indicateur d'item actif
en bordure `brandColors.gold` (remplace l'actuelle bordure encre) —
mêmes principes de contraste déjà vérifiés (navy/blanc ≈16,8:1).
Densité (`dense`/`confortable`) reste un token SÉPARÉ, intouché —
BUILD garde son grain serré, HOME son grain confortable, seule la
COULEUR change, jamais l'espacement.

**B. `TabBar` — accent de marque sur l'onglet actif**
Bordure basse `brandColors.gold` (au lieu de `neutral.text`), texte
`brandColors.navy` (au lieu de `neutral.text`) — sur fond de page
blanc, contraste déjà vérifié par F-039/F-046.

**C. `Card` — nouvelle valeur `tone="brand"` (en plus de
`neutral`/`accent` existants)**
Icône + liseré supérieur (`borderTop: 3px solid brandColors.gold`) —
levier ciblé, réutilise le mécanisme `tone` déjà existant plutôt
qu'une nouvelle prop. Appliqué au cas par cas par chaque app (pas
systématique sur CHAQUE `Card` — resterait à trancher lesquelles,
proposé : les cartes "principales"/premières de chaque écran, pas
les cartes secondaires).

**D. Fond de page — PAS de nouvelle teinte**
Proposition : laisser `body` blanc (`GlobalStyles` intouché). Le poids
visuel de A/B/C (sidebar pleine + accents) porte déjà le changement
perçu ; teinter le fond en plus risquerait un fond peu lisible sans
valeur validée par l'utilisateur. À confirmer/contredire.

**E. CONTROL PWA — nouveau bandeau minimal, jamais `AppShell`**
Reste sans sidebar/topbar complexe (contrainte tactile 360-430px déjà
actée, non remise en cause) — mais gagne un petit bandeau fixe en tête
(navy, repère « K+ », hauteur réduite ~44px) au-dessus du contenu
actuel, cohérent avec le reste de la plateforme sans réintroduire la
densité desktop. Plus gros morceau de nouveauté de ce ticket (aucun
équivalent existant à réutiliser).

**F. `brandGovernance.test.ts` — recentré, pas supprimé**
Sa prémisse HOME-only disparaît, mais UNE règle survit explicitement
(non négociable, reconfirmé à chaque ticket) : `levelMeta.ts`/
`StatusBadge` ne doivent JAMAIS référencer `brandColors` — le
vocabulaire des 5 niveaux Visible Trust reste strictement séparé de
l'identité de marque, quelle que soit l'étendue de cette dernière.
Proposé : test renommé/recentré sur cette seule garde (`StatusBadge`
uniquement dans la liste surveillée), le reste retiré (`AlertBanner`/
`ProgressBar`/`Button`/`Input`/`Select`/`Card`/`Icon`/`TabBar`
peuvent désormais légitimement référencer `brandColors`).

## Scope définitif (proposé)

- `packages/design-system/src/components/AppShell/AppShell.tsx` (+
  test) — sidebar navy, retrait du prop `brand`.
- `packages/design-system/src/components/TabBar/TabBar.tsx` (+ test)
  — accent actif navy/or.
- `packages/design-system/src/components/Card/Card.tsx` (+ test) —
  `tone="brand"`.
- `apps/home/src/App.tsx`, `apps/build/src/App.tsx`,
  `apps/web/src/App.tsx` — retrait de l'appel `brand` (HOME) devenu
  inutile ; application de `tone="brand"` aux cartes principales
  concernées (à identifier précisément par app pendant l'implémentation).
- `apps/control-pwa/src/App.tsx` (+ nouveau composant de bandeau,
  probablement `apps/control-pwa/src/components/BrandBar.tsx` — nom
  à confirmer) + tests associés.
- `packages/design-system/src/brandGovernance.test.ts` — recentré sur
  `StatusBadge` seul.
- `CLAUDE.md` — section F-047 ; **révision de la doctrine 17.3
  elle-même** (le texte actuel qui la décrit sur plusieurs tickets
  passés reste comme historique, mais une note explicite doit
  indiquer qu'elle est levée depuis F-047, pour qu'un futur lecteur ne
  s'y fie pas à tort).

## Hors scope

- `levelMeta.ts`/`TrustLevel` — jamais modifié (seule règle non
  négociable qui survit à la levée de 17.3).
- Nouvelle couleur autre que `brandColors.navy`/`brandColors.gold`
  existants — aucune valeur inventée.
- Asset logo réel (« K+toit ») — repère textuel seul, comme F-039/
  F-046.
- Teinte de fond de page (décision D) — sauf contre-confirmation.

## Critères d'acceptation (proposés)

- [ ] Sidebar `AppShell` navy sur les 4 apps qui l'utilisent (HOME/
      BUILD/web), accent actif or.
- [ ] `TabBar` : onglet actif en accent or/navy sur les 4 apps qui
      l'utilisent.
- [ ] CONTROL PWA : bandeau navy minimal présent, layout tactile/
      44px inchangé par ailleurs.
- [ ] `Card tone="brand"` disponible et appliqué au moins une fois
      par app.
- [ ] `brandGovernance.test.ts` recentré sur `StatusBadge`
      uniquement, toujours vert ; `levelMeta.ts` toujours intouché
      (`git diff` vide sur ce fichier).
- [ ] Zéro régression fonctionnelle : suite complète des 5 packages
      verte (baseline avant ticket : 511 tests), `tsc --noEmit`
      propre sur toutes les apps touchées.
- [ ] Vérification visuelle réelle (capture d'écran + `getComputedStyle`
      contre le backend + les 4 apps démarrées) sur CHAQUE app,
      avant de considérer le ticket terminé.
- [ ] `CLAUDE.md` : doctrine 17.3 explicitement marquée levée depuis
      ce ticket, registre de données de démo mis à jour si une
      nouvelle vérification en crée.

## Note sur l'ampleur

Ce ticket est comparable à F-045 en volume (multi-app, plusieurs
composants partagés modifiés) — proposé : séquencer en phases
vérifiées une par une (A+F d'abord — fondation partagée — puis B/C,
puis D/E par app), même discipline que F-045, plutôt qu'un commit
massif.
