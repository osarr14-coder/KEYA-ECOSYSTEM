# Ticket F-037 — Décomposition complète de la marge du grand-livre

## Statut
Livré (branche `feature/frontend-round-2`). **Ferme définitivement la
dépendance backend documentée depuis F-035** (« construction courante non
exposée comme poste isolé ») — `F-035-grand-livre-lot.md` peut être marqué
entièrement clos.

## Contexte

Suite directe de F-035/F-035 bis : `GET .../lot-ledgers/{lot_id}/margin/`
ne renvoyait jusqu'ici que `{margin: "..."}`, forçant l'écran à passer sous
silence le détail de la construction courante (recalculer
`devis.amount + Σ écarts` côté frontend aurait violé la doctrine « aucun
calcul frontend »). Le ticket backend **B-038**
(`decomposition-complete-marge-grand-livre`) a étendu cette réponse pour
exposer les 6 valeurs qui composent le calcul.

## Vérification préalable — synchronisation de branche

**Piège rencontré, même famille que F-035 bis** : au début de ce ticket,
`git log -- backend/apps/procurement backend/apps/pricing` ne montrait
AUCUNE trace de B-038 sur `origin/master`. Investigation plus poussée
(`git log --all | grep B-038`) a révélé que B-038 existait bien, mais sur
la branche `master` **locale** de ce dépôt (partagée entre worktrees sur
cette machine) — 2 commits en avance sur `origin/master`, jamais poussés
par la session backend au moment de la vérification. `git merge master`
(la référence locale, pas `origin/master`) a débloqué la suite sans
attendre le push — lecture seule, sans impact sur l'autre worktree.
**Leçon** : dans un environnement multi-worktree, une branche locale
partagée peut être en avance sur son remote-tracking ref — vérifier les
deux avant de conclure qu'une fonctionnalité backend n'existe pas encore.

## Contrat API vérifié

`GET /api/procurement/lot-ledgers/{lot_id}/margin/?organization_id=<id>`
— **extension ADDITIVE, jamais un contrat cassé** (`margin` reste présent
exactement comme avant). Réponse complète :

```json
{
  "prix_client": "...",
  "foncier_alloue": "...",
  "be_alloue": "...",
  "construction_courante": "...",
  "bc_charges_total": "...",
  "margin": "..."
}
```

Toutes les valeurs `Decimal` sérialisées en chaînes (même convention que
`LotLedgerSerializer`). `margin = prix_client - foncier_alloue -
be_alloue - construction_courante - bc_charges_total` — calculé une seule
fois côté backend (`_compute_lot_ledger_margin_breakdown`), jamais
dupliqué. 404 si aucun grand-livre n'existe (comportement inchangé).

## Implémentation

**`apps/web/src/api/types.ts`** — nouvelle interface
`LotLedgerMarginBreakdown` (6 champs), remplace l'ancien type inline
`{ margin: string }`. **`apps/web/src/api/client.ts::getLotLedgerMargin`**
— type de retour mis à jour, aucun changement de signature.

**`LotLedgerPanel.tsx`** — refonte du composant qui affichait
auparavant `LotLedgerDetail` (dl prix/foncier/BE depuis `LotLedger` +
`LotLedgerMargin` séparé, marge seule) :
- **`LotLedgerMarginBreakdown`** (renommage de `LotLedgerMargin`) affiche
  désormais les 6 postes en UNE SEULE liste ordonnée : prix client
  (cession) en haut, puis chaque coût déduit (foncier alloué, BE alloué,
  construction courante, charges bureau de contrôle), marge résultante en
  bas — cohérent avec la doctrine de transparence du modèle économique.
  Chaque ligne préfixée `−` (coûts) ou `=` (résultat) pour rendre le sens
  du calcul explicite visuellement, pas seulement par l'ordre. Toutes les
  valeurs viennent TELLES QUELLES de la réponse API — aucune arithmétique
  côté frontend, `isNegative` reste une simple lecture de signe (même
  principe que `DevisAjustement.ecart < 0`).
- **`LotLedgerDetail` (l'ancien wrapper prix/foncier/BE) supprimé** —
  devenu un pur pass-through une fois son propre contenu absorbé par
  `LotLedgerMarginBreakdown`. `LotLedgerPanel` appelle directement ce
  dernier.
- **Mention « détail construction disponible dans l'onglet Devis »
  retirée** (devenue obsolète) — remplacée par l'affichage direct du
  poste `construction_courante`.
- `LotBcChargesPanel` (F-035 bis) inchangé — reste dédié aux lignes
  INDIVIDUELLES de charges BC, jamais un total recalculé localement, même
  si `bc_charges_total` existe désormais dans la réponse `/margin/`
  (deux informations complémentaires, pas redondantes : l'une est la
  somme déjà faite par le backend, l'autre le détail ligne par ligne).

## Tests

Écrits/adaptés AVANT de considérer le ticket terminé. Le describe block
« détail d'un grand-livre existant » (F-035) est réécrit en « décomposition
complète de la marge » (F-037) : nouveau fixture `makeMarginBreakdown`
(6 champs), tests vérifiant chaque poste individuellement
(`data-testid` dédiés : `lot-ledger-prix-client`,
`-foncier-alloue`, `-be-alloue`, `-construction-courante`,
`-bc-charges-total`, `-margin`), l'ORDRE réel du DOM (requête directe sur
les `<dt>` du `<dl>`, comparaison de position DOM pour la ligne de marge —
jamais une supposition sur l'ordre de rendu), l'absence de la mention
obsolète, marge positive/négative toujours distinguées visuellement.

**15 tests** (`LotLedgerPanel.test.tsx`, remplace les 14 précédents un
par un plus 1 nouveau sur l'ordre). **447 tests frontend** (5 packages :
64+75+73+55+180), zéro régression (2 exécutions consécutives propres),
`tsc --noEmit` propre.

## Vérification en navigateur réel

**Effectuée, backend réellement disponible cette fois** (contrairement à
F-035, où aucun backend n'était démarré) — Postgres du projet
(`docker compose up`, port 5433), migrations appliquées, données seedées
via un script Django shell temporaire (utilisateur `admin_keyimmo`, deux
organisations, `ProgramCost`, `PricingConfig` canal 1 à 12 %, un lot avec
devis verrouillé). Serveur Django (`:8000`) + serveur Vite `apps/web`
(`:5176`) démarrés manuellement, JWT injecté directement en
`localStorage` (contournement du flux de connexion complet, équivalent
au mécanisme manuel documenté depuis les tickets 008-010).

**Piège rencontré** : le premier lot seedé avait déjà reçu son
`LotLedger` via le script de seed — devenu introuvable via les DEUX
sélecteurs de `DevisView` (`search_lots_as_admin` ET
`search_lots_eligible_for_ledger_as_admin` excluent tous deux un lot déjà
pourvu d'un grand-livre, limite déjà documentée au ticket F-036). Corrigé
en seedant un SECOND lot, verrouillé mais SANS grand-livre créé au
préalable — a permis de tester le VRAI parcours utilisateur (sélection du
lot verrouillé → formulaire de création → décomposition affichée), pas
seulement un état déjà construit en base.

**Résultat observé, chiffres réels non fabriqués** : `ProgramCost` du lot
seedé (foncier 18 000 000,00 / BE 3 600 000,00, un seul lot dans son
programme → 100 % de la répartition), devis verrouillé à 30 000 000,00
(aucun ajustement), prix client saisi via le formulaire réel : 40
000 000,00. L'écran a affiché, dans l'ordre exact demandé :

```
Prix client (cession)         40000000
− Foncier alloué              18000000
− BE alloué                    3600000
− Construction courante       30000000
− Charges bureau de contrôle         0
Marge disponible : -11600000 (négative)
```

Arithmétique vérifiée manuellement : `40 000 000 − 18 000 000 − 3 600 000
− 30 000 000 − 0 = −11 600 000` — exact. La marge négative a déclenché le
bandeau `AlertBanner` distinct, comme prévu. Requêtes réseau inspectées
(`POST .../lot-ledgers/ → 201`, `GET .../margin/ → 200`) : aucune erreur
côté ce ticket. Nettoyage effectué après vérification : serveurs arrêtés,
conteneur Docker supprimé (`docker compose down`), scripts de seed
temporaires supprimés du dépôt.

## Dépendances
Aucune — dernière dépendance connue (construction courante) levée par ce
ticket. `F-035-grand-livre-lot.md` marqué entièrement clos.
