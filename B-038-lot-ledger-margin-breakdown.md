# Ticket B-038 — Décomposition complète de la marge du grand-livre

## Statut

**Implémenté, testé, documenté.** 3 tests dédiés/étendus
(`apps/procurement/tests.py`), suite `procurement` 92 tests (+1), suite
complète du projet 363 tests, tous verts.

## Origine

Identifié par la session frontend en construisant **F-035** (écran du
grand-livre) : `GET .../lot-ledgers/{lot_id}/margin/` ne renvoie
aujourd'hui QUE la marge finale (`{'margin': ...}`) — recalculer
« construction courante » côté frontend (`devis.amount + Σ écarts`)
violerait la doctrine « aucun calcul métier côté frontend », déjà
appliquée strictement partout ailleurs dans ce projet (ex. `isNegative`
sur la marge = simple lecture de signe, jamais un calcul). Toutes les
valeurs existent déjà côté backend — `get_lot_ledger_margin` (B-035/B-036)
les calcule en interne mais ne retourne que le résultat final, jamais les
postes qui le composent.

## Vérification préalable — consommateurs actuels de l'endpoint

**Backend** : `apps.procurement.views.LotLedgerMarginView` — seul point
d'entrée HTTP. `apps.procurement.services.get_lot_ledger_margin_for_lot`
— seule fonction qui l'appelle (aucun autre appelant dans le projet).
Tests existants (`apps/procurement/tests.py`) : tous les tests sur cette
route vérifient soit un code HTTP, soit `response.data['margin']`
spécifiquement — **aucun test n'effectue d'égalité stricte sur le dict
complet de la réponse**, une extension additive du corps de réponse ne
casse donc rien côté backend.

**Frontend** : `apps/web/src/api/client.ts::getLotLedgerMargin`, typé
`request<{ margin: string }>(...)` — un type INLINE, jamais une interface
partagée dans `types.ts`. Seul consommateur réel :
`LotLedgerPanel.tsx::LotLedgerMargin`, qui ne lit que `margin`. Tous les
mocks de test (`LotLedgerPanel.test.tsx`) ne fournissent que `{margin:
...}`. **Une extension additive du corps de réponse ne casse rien côté
frontend non plus** — le type inline actuel ignorerait simplement les
nouveaux champs tant qu'un futur ticket frontend ne les adopte pas
explicitement (ce ticket-ci reste backend seul, décision D ci-dessous).

**Conclusion : ÉTENDRE l'endpoint existant, ne PAS en créer un second.**
Un seul consommateur (le composant marge de `LotLedgerPanel`), même
requête conceptuelle (« la marge disponible d'un grand-livre, avec ou
sans détail »), même schéma RLS déjà en place — un second endpoint
dupliquerait l'appel réseau et devrait rester perpétuellement synchronisé
avec le même calcul, pour aucun bénéfice réel identifié.

## Décisions de conception proposées

**A. Extraction d'un helper privé PARTAGÉ, même discipline que le
refactor B-037 (`_search_lots_by_name_as_admin`)** :
`_compute_lot_ledger_margin_breakdown(ledger)` calcule TOUT une seule
fois (devis verrouillé, `construction_courante`, `bc_charges_total`,
`margin`) et retourne un dict. `get_lot_ledger_margin(ledger)` — 
INCHANGÉE dans sa signature et son type de retour (`Decimal` nu) — devient
un mince wrapper : `return _compute_lot_ledger_margin_breakdown(ledger)['margin']`.
Ses deux appelants existants (`_maybe_alert_negative_margin`, ticket
B-036, et un test qui l'appelle directement) ne changent pas d'une ligne.

**B. `get_lot_ledger_margin_for_lot` (seule fonction appelant l'ancienne
`get_lot_ledger_margin`, seul appelant : la vue) — RENOMMÉE
`get_lot_ledger_margin_breakdown_for_lot`, retourne désormais
`(ledger, breakdown_dict)` au lieu de `(ledger, margin_decimal)`.** Un
seul appelant à mettre à jour (`LotLedgerMarginView`), même ticket.
Renommage plutôt que garder l'ancien nom avec un type de retour changé —
même discipline de nommage explicite que `get_devis_status`/
`get_candidate_visible_devis_status` (jamais deux fonctions de noms
proches avec des contrats silencieusement différents).

**C. `get_lot_ledger_margin_breakdown(ledger)` — nouvelle fonction
PUBLIQUE, bascule-free (même précondition d'appel que
`get_lot_ledger_margin`), pour symétrie avec l'existant** et pour qu'un
futur appelant (export, autre vue) puisse la réutiliser directement sans
repasser par la variante `_for_lot`.

**D. Endpoint ÉTENDU (décision confirmée ci-dessus), réponse JSON
enrichie, PAS de nouveau serializer** — même style que la réponse
actuelle (`Response({'margin': ...})`, valeurs `Decimal` brutes, JSON les
sérialise nativement, déjà le style de `DevisAjustementView`/
`LotLedgerMarginView` existants). Champs ajoutés : `prix_client`,
`foncier_alloue`, `be_alloue`, `construction_courante`,
`bc_charges_total` — noms alignés sur le vocabulaire déjà établi
(`LotLedgerSerializer`), sauf `bc_charges_total` (aucun nom existant
pour cet agrégat, jamais exposé jusqu'ici).

**E. Explicitement HORS SCOPE : toute consommation frontend.** Ce ticket
ferme la dépendance backend documentée dans `F-035-grand-livre-lot.md`
(« construction courante non exposée comme poste isolé ») — l'exploiter
réellement dans `LotLedgerPanel` (afficher le détail au lieu du seul
résumé texte actuel) est un futur ticket frontend, une fois ce contrat
disponible.

## Entités touchées

**`apps/procurement/services.py`** :
- `_compute_lot_ledger_margin_breakdown(ledger)` — NOUVELLE, privée.
- `get_lot_ledger_margin(ledger)` — RÉÉCRITE en wrapper, signature/type
  de retour inchangés.
- `get_lot_ledger_margin_breakdown(ledger)` — NOUVELLE, publique.
- `get_lot_ledger_margin_for_lot` → RENOMMÉE
  `get_lot_ledger_margin_breakdown_for_lot`, retour changé (dict au lieu
  de `Decimal`).

**`apps/procurement/views.py`** : `LotLedgerMarginView.get` — appelle la
fonction renommée, sérialise les 6 champs.

**Aucun changement** : `apps/procurement/models.py`,
`apps/procurement/serializers.py`, `apps/procurement/urls.py` (même
route, même nom `lot-ledger-margin`), tout fichier frontend.

## Scope inclus

- Refactor de `get_lot_ledger_margin`/extraction du helper privé.
- `get_lot_ledger_margin_breakdown` + `get_lot_ledger_margin_breakdown_for_lot`
  (renommage).
- Extension de la réponse JSON de `GET .../lot-ledgers/{lot_id}/margin/`.

## Explicitement hors scope

- **Toute consommation frontend** des nouveaux champs (décision E).
- **Tout nouveau serializer DRF** — réponse construite à la main, comme
  aujourd'hui.
- **Toute modification du calcul lui-même** — même formule EXACTE que
  B-035/B-036, seulement exposée en détail plutôt qu'agrégée.

## Critères d'acceptation

- [x] `GET .../lot-ledgers/{lot_id}/margin/` renvoie `prix_client`,
      `foncier_alloue`, `be_alloue`, `construction_courante`,
      `bc_charges_total`, `margin` — les 6 valeurs cohérentes avec un
      grand-livre construit dans le test (mêmes montants que ceux
      utilisés pour le créer/pour ses charges BC).
      (`TestLotLedgerMargin::test_margin_equals_prix_client_minus_foncier_be_minus_construction_amount`,
      étendu ; `TestLotLedgerMarginIncludesBcCharges::test_margin_subtracts_cumulative_bc_charges`,
      étendu)
- [x] `construction_courante` reflète `devis.amount + Σ écarts acceptés`
      — testé avec au moins un `DevisAjustement`, pas seulement
      `devis.amount` seul (même discipline de preuve que B-035/B-036).
      (même tests ci-dessus, plus `test_margin_equals_the_arithmetic_of_the_other_returned_fields`)
- [x] `bc_charges_total` reflète la somme de TOUTES les `LotBcCharge` du
      lot — testé avec au moins deux charges cumulées (une `fixed_amount`,
      une `global`, même scénario que B-036).
      (`test_margin_subtracts_cumulative_bc_charges`, étendu — `70000.00`
      = `50000.00` fixe + `20000.00` globale)
- [x] `margin` reste EXACTEMENT égale à `prix_client - foncier_alloue -
      be_alloue - construction_courante - bc_charges_total` — vérifié par
      calcul explicite dans le test, pas seulement une valeur en dur.
      (`TestLotLedgerMargin::test_margin_equals_the_arithmetic_of_the_other_returned_fields`
      — NOUVEAU, calcule `margin` à partir des AUTRES champs retournés
      par la réponse elle-même, scénario où aucun poste ne vaut zéro par
      hasard)
- [x] **Non-régression explicite** : `get_lot_ledger_margin` conserve son
      type de retour (`Decimal` nu) et son comportement — le test existant
      qui l'appelle directement (`TestLotBcChargeNegativeMarginAlert`)
      passe SANS AUCUNE modification.
      (fichier de test NON modifié à cet endroit — vérifié par le passage
      vert de la suite complète)
- [x] 404 si aucun grand-livre n'existe encore pour le lot (comportement
      inchangé).
      (`test_margin_endpoint_returns_404_when_no_ledger_exists_yet`, NON
      modifié)
- [x] Rôle non-admin → 403 (comportement inchangé).
      (`test_a_constructeur_cannot_read_the_margin`, NON modifié)
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits
      avant de considérer le ticket terminé.

## Notes d'implémentation

**Refactor sans surface de risque, même discipline que B-037** :
`_compute_lot_ledger_margin_breakdown` extrait le corps EXACT de
l'ancienne `get_lot_ledger_margin` (même ordre d'opérations). Les DEUX
fonctions publiques (`get_lot_ledger_margin`, `get_lot_ledger_margin_breakdown`)
délèguent à ce même helper — aucune formule dupliquée, aucun risque de
divergence future entre « la marge seule » et « la marge en détail ».

**Renommage assumé plutôt qu'un contrat silencieusement changé** :
`get_lot_ledger_margin_for_lot` → `get_lot_ledger_margin_breakdown_for_lot`
(son unique appelant, `LotLedgerMarginView`, mis à jour dans le même
ticket) — son type de retour passe d'un `Decimal` nu à un dict complet,
un nom inchangé aurait masqué ce changement de contrat pour tout futur
lecteur du code.

**Non-régression prouvée, pas seulement présumée** : `get_lot_ledger_margin`
elle-même n'a été touchée dans AUCUN de ses deux appelants existants
(`_maybe_alert_negative_margin` en code, `TestLotBcChargeNegativeMarginAlert`
en test) — la suite complète (363 tests) confirme qu'aucune des deux
n'a eu besoin d'ajustement.

**Aucune anomalie trouvée en écrivant les tests.**

3 tests dédiés/étendus, suite `procurement` 92 tests, suite complète du
projet 363 tests, tous verts.
