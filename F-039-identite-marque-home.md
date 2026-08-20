# Ticket F-039 — Identité de marque KEYIMMO AFRIC dans HOME (portée ciblée)

## Statut
Décision de conception tranchée avec l'utilisateur, suite à l'audit visuel déclenché par le ticket F-038 : le design system actuel (`packages/design-system/src/tokens/colors.ts`) ne contient aucune trace de la palette de marque KEYIMMO AFRIC (navy `#0B1D3A`, or `#C49A2C`) — confirmé par lecture intégrale des fichiers de tokens. HOME (l'écran client final) est aujourd'hui visuellement identique aux outils internes (BUILD, apps/web), sans aucune identité de marque.

## Décision de portée — non négociable
**Réintroduction ciblée et minimale, HOME uniquement.** Les écrans professionnels (BUILD, CONTROL, apps/web) restent inchangés, sur la palette neutre actuelle — cohérent avec la doctrine 17.3 de la V3.0 ("les écrans professionnels privilégient densité et vitesse de scan").

**Ne jamais toucher à `levelMeta.ts` (TrustLevel)** — palette explicitement protégée depuis le ticket 003/007, seule exception "couleur de marque" du projet jusqu'ici. Ce ticket ne doit ni la modifier ni s'en inspirer pour les nouvelles valeurs.

## Scope

### 1. Nouveau groupe de tokens — `brandColors`
Dans `packages/design-system/src/tokens/colors.ts`, ajouter un groupe séparé (pas dans `semanticColors`) :

Ces deux valeurs, et uniquement elles — pas de nuances dérivées inventées sans besoin démontré.

### 2. Consommation strictement limitée
- `AppShell`, dans sa variante HOME uniquement (déjà distincte de la variante dense depuis le ticket 007) : fond ou accent du "chrome" (en-tête, zone de logo) en `brandColors.navy`, avec le logo K+toit si un asset est déjà disponible dans le projet — vérifier son existence avant de le référencer.
- Le bouton d'action principal de HOME (call-to-action le plus visible de l'écran, ex: action prioritaire de `PriorityTaskSummary` ou équivalent) peut utiliser `brandColors.gold` comme accent — à vérifier au cas par cas si un bouton de ce type existe déjà et lequel est le plus pertinent.
- **Aucun autre composant** ne doit consommer `brandColors` dans ce ticket — pas `AlertBanner`, pas `StatusBadge`, pas `ProgressBar`, pas les composants F-038 (`Button`/`Input`/`Select`) tels qu'utilisés ailleurs que dans HOME.

### 3. Vérification visuelle réelle — obligatoire, avec la méthode corrigée depuis F-038
- Vérifier en priorité si le problème de capture d'écran (`computer{action:"screenshot"}` échouant, F-038) est résolu avant de commencer ce ticket. Si toujours bloqué, documenter explicitement la tentative et la solution de contournement utilisée (inspection DOM/CSS réelle contre un backend démarré, comme au ticket F-038) — jamais présenter l'un comme équivalent à l'autre.
- Comparer visuellement HOME avant/après — l'objectif est que l'écran soit reconnaissable comme "KEYIMMO AFRIC" sans ambiguïté, pas juste techniquement conforme aux valeurs de tokens.

## Critères d'acceptation
- [x] `brandColors` existe comme groupe de tokens séparé, testé (existence des deux valeurs exactes)
- [x] Un test de garde vérifie qu'aucun composant partagé (`AlertBanner`, `StatusBadge`, `ProgressBar`, `Button`, `Input`, `Select`) ne référence `brandColors` — seule la variante HOME d'`AppShell` (et éventuellement un bouton CTA précis identifié pendant l'implémentation) y a accès
- [x] `levelMeta.ts` (TrustLevel) reste strictement inchangé — vérifié par diff, pas par affirmation
- [ ] Vérification visuelle réelle — NON obtenue par l'outillage automatisé malgré deux tentatives complètes et méthodiques (voir section dédiée) ; documentée honnêtement, **en attente d'un contrôle humain réel** avant fusion vers `master`, pas d'un outil automatisé
- [x] Aucune régression sur les écrans BUILD/CONTROL/apps/web — suite complète verte

## Explicitement hors scope
- Toute modification de BUILD, CONTROL, apps/web (back-office, Devis, tarifs, paliers légaux, grand-livre) — restent neutres
- Toute modification de `levelMeta.ts`/TrustLevel
- Nuances dérivées de `brandColors` (variantes claires/foncées) au-delà des deux valeurs exactes déjà validées
- Refonte visuelle globale de HOME au-delà du chrome et du CTA principal identifiés

## Dépendances
Aucune dépendance backend. S'appuie sur la variante HOME déjà distincte d'`AppShell` (ticket 007), et sur la correction de méthode de vérification visuelle établie au ticket F-038.

---

## Statut final
Committé sur `feature/frontend-round-2` (PAS fusionné vers `master`).
**Vérification visuelle en attente d'un contrôle humain réel** — voir
section ci-dessous : deux tentatives complètes d'inspection en
navigateur réel ont échoué pour des raisons d'environnement (outil
Browser incapable de joindre un port localhost de cette machine, malgré
une investigation méthodique de la cause), jamais par manque d'effort.
Le code, les tokens et les tests sont livrés et vérifiés (suite
complète verte, `tsc --noEmit` propre, gardes de gouvernance vertes) —
seul le rendu visuel réel de l'écran HOME (navy/or effectivement
appliqués, lisibilité du repère de marque, cohérence globale) reste à
confirmer par un humain avant toute fusion vers `master`.

## Vérification préalable — capture d'écran (demandée explicitement avant de commencer)

`computer{action:"screenshot"}` retesté seul, avant tout code, sur le panneau Browser déjà ouvert (aucun onglet fermé volontairement au préalable) : échec identique à F-038 — « the Browser pane is not displayed, so the page is not compositing frames ». `preview_list` confirme qu'il s'agit de la MÊME session Browser globale que celle diagnostiquée au ticket F-038 (`sessionId: local_3b5948b2-...`, `startedAt` inchangé depuis la veille, jamais redémarrée) — pas une régression propre à ce ticket, la même limite d'environnement non résolue.

**Constat plus grave, découvert PENDANT la vérification visuelle de ce ticket (nouveau par rapport à F-038)** : la navigation elle-même est devenue instable, pas seulement la capture. Sur 3 onglets différents (dont deux tout neufs, créés spécifiquement pour écarter un état corrompu d'un onglet réutilisé), le même motif s'est reproduit 4 fois : `navigate` vers `http://localhost:5173` (serveur `apps/home` réellement démarré, confirmé joignable par `curl` local avec un `200` direct depuis cette machine) rapporte un succès et affiche même brièvement le bon titre (« KEYA — Mon bien »), mais l'appel suivant (`javascript_tool`, `get_page_text`, ou même `tabs_context`) trouve systématiquement l'onglet retombé sur `chrome-error://chromewebdata/`, titré `localhost:5176` — le port de ma PROPRE session F-038 précédente, déjà arrêté de mon côté à ce moment. Cette instabilité, combinée à la découverte déjà faite au tour précédent (`preview_list` révélant un `cwd` pointant vers `C:\Projets claude\KEYA`, projet sibling sans lien), confirme que ce panneau Browser est une ressource partagée entre plusieurs sessions Claude Code actives sur cette machine, et qu'une autre session semble le disputer en temps réel au moment de cette vérification.

**Contournement utilisé, jamais présenté comme équivalent** : vérification par les assertions `getComputedStyle`/`toHaveStyle` déjà écrites dans la suite Vitest+jsdom (`AppShell.test.tsx`, `PriorityTaskSummary.test.tsx`) — déterministes, déjà vertes, et portant sur EXACTEMENT les mêmes faits visuels visés (fond navy de l'en-tête, texte blanc, bordure or 2px, repère de marque affiché, bordure/texte du CTA en or/navy). Ce n'est PAS une vérification en navigateur réel contre un backend démarré (le niveau de rigueur atteint pour F-037/F-038) — seulement le meilleur niveau de preuve disponible une fois la ressource Browser confirmée indisponible/contestée. Signalé explicitement plutôt que dissimulé.

### Seconde tentative, demandée explicitement par l'utilisateur avant tout commit — diagnostic affiné

Une seconde session de vérification complète a été retentée (backend + `apps/home` redémarrés, JWT frais, données réelles déjà seedées) avec un protocole plus rigoureux pour isoler la cause, à la demande explicite de l'utilisateur (« isoler ta session, aucun autre panneau Browser actif ailleurs ») :

1. `preview_list` confirme un seul onglet actif (`seed`), déjà sur `localhost:5173` — pas de contention visible d'un second onglet.
2. `navigate` vers `localhost:5173`, suivi d'une attente EXPLICITE de 3s (`computer{wait}`) avant toute autre action : l'onglet revient déjà, à l'intérieur de ce délai d'attente lui-même (donc AVANT tout nouvel appel de mon côté), sur `chrome-error://chromewebdata/` titré `localhost:5176` — un port confirmé mort sur cette machine (`netstat`). Ceci écarte l'hypothèse initiale (F-038/tour précédent) d'un autre onglet/session qui "gagnerait la course" contre mes propres appels : la réversion se produit de façon AUTONOME, sans action de ma part dans l'intervalle.
3. **Test de contrôle décisif** : `navigate` vers `https://example.org` (URL externe) sur ce MÊME onglet, suivi de la même attente de 3s → reste PARFAITEMENT STABLE, aucune réversion. La même séquence appliquée à `localhost:5173` échoue systématiquement ; appliquée à une URL externe, elle réussit systématiquement.
4. Navigation EXPLICITE vers `http://localhost:5176` lui-même (le port "fantôme" affiché) → refusée d'emblée (« navigation ... was denied or failed »), prouvant que ce n'est pas un port réellement joint avec succès par l'outil, seulement une référence périmée affichée par défaut.
5. `preview_start({url: "http://localhost:5173"})` (le chemin recommandé par l'outil plutôt que `navigate` brut, un nouvel onglet dédié) → rapporte `navOk: true`, mais la lecture immédiate de `location.href` retourne à nouveau `chrome-error://chromewebdata/`.

**Conclusion révisée, plus précise que celle de la première tentative** : ce n'est pas (ou plus seulement) une contention entre sessions sur un même onglet — c'est que **l'outil Browser ne parvient actuellement à joindre AUCUN port localhost de cette machine**, par aucune méthode testée (`navigate` répété, onglet isolé neuf, `preview_start`), alors qu'une URL externe fonctionne de façon parfaitement stable dans la même session, sur le même onglet, à la même minute. `localhost:5176` (le titre affiché après chaque échec) n'est pas un port réellement atteint — une navigation explicite vers ce port échoue elle aussi — c'est une référence résiduelle affichée par défaut plutôt qu'un état d'erreur clair. **Aucune vérification visuelle réelle n'a donc pu être obtenue pour ce ticket, malgré deux tentatives complètes et une investigation méthodique de la cause.** Conformément à l'instruction explicite de l'utilisateur, ce constat est documenté avant tout commit plutôt que dissimulé ou présenté comme résolu.

### Pour un contrôle humain manuel

`apps/home` (`npm run dev`, port 5173 par défaut), backend démarré
(`docker compose up` + `manage.py runserver`), un utilisateur avec au
moins une `LotClient` assignée (voir `apps.programs.models.LotClient`,
aucun endpoint d'écriture — assignation par l'ORM, cohérent avec le
ticket 008). L'en-tête doit apparaître en fond navy (`#0B1D3A`) avec une
bordure inférieure or (`#C49A2C`) et le repère « K+ KEYIMMO AFRIC » ; le
bouton « Voir toutes mes actions » (Vue d'ensemble, résumé de la tâche
prioritaire) doit porter une bordure or 2px et un texte navy, fond
transparent.

## Asset logo K+toit — vérifié avant toute référence, confirmé absent

Recherche exhaustive (`find` sur toutes les extensions image usuelles, hors `node_modules`/`venv`) : un seul fichier image lié au projet existe, `apps/control-pwa/public/icon.svg` — une icône générique (carré arrondi gris + coche blanche), sans aucun rapport avec KEYIMMO AFRIC ou un motif "K+toit". **Aucun asset logo n'a donc été référencé.** Substitué par un repère de marque textuel (`<span>K+</span><span>KEYIMMO AFRIC</span>`, "K+" en or sur fond navy — contraste ≈6,4:1, largement conforme WCAG AA) directement dans `AppShell`, plutôt que de pointer vers un fichier inexistant. Si un asset réel est fourni plus tard, un futur ticket pourra le substituer à ce repère texte sans changer l'API du composant (`brand?: boolean` reste inchangée).

## Implémentation

**`brandColors`** (`packages/design-system/src/tokens/colors.ts`) — groupe séparé de `semanticColors`, exactement deux valeurs (`navy: '#0B1D3A'`, `gold: '#C49A2C'`), aucune nuance dérivée. Exporté depuis `index.ts` (`brandColors`, type `BrandColorTokens`).

**`AppShell`** (`packages/design-system/src/components/AppShell/AppShell.tsx`) — nouveau prop `brand?: boolean` (défaut `false`), volontairement EXPLICITE plutôt que dérivé de `density === 'confortable'` : aujourd'hui seule HOME utilise cette densité, mais coupler le rendu de marque à la densité aurait créé un couplage implicite fragile — même principe que `requiredRoles`/`userRoles` (ticket 007), c'est à l'app consommatrice de le demander. Quand `brand` est actif : en-tête (`data-testid="app-shell-header"`) en fond `brandColors.navy`, texte blanc, bordure inférieure `2px solid brandColors.gold` (au lieu de la bordure neutre 1px habituelle), et repère de marque textuel affiché avant le formulaire de recherche. Absent ou `false` : comportement strictement inchangé pour BUILD/CONTROL/apps/web — vérifié par la suite complète (voir plus bas).

**`apps/home/src/App.tsx`** — seul appelant du projet à passer `brand` (implicitement `true`) à `AppShell`.

**`apps/home/src/views/PriorityTaskSummary.tsx`** — le CTA « Voir toutes mes actions » (résumé de la tâche prioritaire, en tête de Vue d'ensemble — le call-to-action le plus visible de HOME, cohérent avec l'exemple donné par le ticket) migré du `<button>` brut vers le composant `Button` (F-038, `variant="secondary"`), avec un override de style `borderColor: brandColors.gold, borderWidth: '2px', color: brandColors.navy`. **Le or n'est jamais utilisé en fond plein** : calculé avant implémentation, un texte blanc sur `brandColors.gold` ne mesure qu'≈2,6:1 (échec WCAG AA, qui exige 4,5:1) — un remplissage doré uniforme aurait donc été un défaut d'accessibilité connu et ignoré. Le or reste un ACCENT (bordure), exactement la formulation du ticket (« peut utiliser `brandColors.gold` comme accent ») ; le texte navy sur fond transparent/blanc mesure ≈16,8:1 (largement AAA).

## Test de garde — `brandGovernance.test.ts`

Nouveau fichier (`packages/design-system/src/brandGovernance.test.ts`), même famille que `governance.test.ts` (ticket 007) : scanne le CODE SOURCE réel (pas une revue manuelle) de `AlertBanner`, `StatusBadge` (y compris `levelMeta.ts`/`shapes.tsx`), `ProgressBar`, `Button`, `Input`, `Select` à la recherche de la chaîne littérale `"brandColors"` — absence confirmée dans les 6. Un test de CONTRÔLE POSITIF vérifie explicitement qu'`AppShell`, lui, référence bien `"brandColors"` — preuve que le scan fonctionne réellement plutôt que de passer vide par accident (même discipline que la vérification manuelle du ticket 007 avec un composant fixture temporaire).

`levelMeta.ts` — inclus dans ce scan (protection automatique), ET vérifié séparément par `git diff --stat`/`git status --short` : diff vide, fichier strictement inchangé, pas seulement affirmé.

## Tests et suite complète

7 nouveaux tests `brandGovernance.test.ts`, +2 `colors.test.ts`, +3 `AppShell.test.tsx`, +1 `PriorityTaskSummary.test.tsx` — 13 tests dédiés au total. **478 tests frontend** (5 packages : 94+75+73+56+180), zéro régression sur BUILD (75)/CONTROL PWA (73)/apps/web (180) — inchangés à l'unité près, 2 exécutions consécutives propres. `tsc --noEmit` propre sur les 5 packages.

## Vérification de données réelles (backend démarré, malgré l'échec de la vérification VISUELLE)

Avant de constater l'instabilité du panneau Browser (voir plus haut), un jeu de données minimal a été seedé contre un backend réellement démarré (Postgres du volume réutilisé, migrations à jour) : organisation existante réutilisée, `Program`/`Asset`/`Lot`/`LotClient` créés pour un nouvel utilisateur `client-f039@example.com`, une `Task` `pending` assignée pour peupler `PriorityTaskSummary`. Serveur `apps/home` démarré (`:5173`, confirmé joignable en `curl` avec un `200`), JWT généré. La donnée était donc prête pour une vérification visuelle complète (en-tête + CTA) — seule l'instabilité du panneau Browser partagé a empêché de l'observer. Nettoyage effectué : serveurs Django/Vite arrêtés, conteneur Docker supprimé (volume préservé, aucun script de seed laissé dans le dépôt — création faite en ligne via `manage.py shell`, comme aux tickets précédents).
