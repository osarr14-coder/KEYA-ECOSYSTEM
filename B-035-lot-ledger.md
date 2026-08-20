# Ticket B-035 — Grand-livre de coûts par lot (canal 1), première partie

## Statut

**Implémenté, testé, documenté.** 17 tests dédiés (`apps/procurement/tests.py`),
suite `procurement` 71 tests, suite complète du projet 339 tests, tous
verts.

## Origine

Le chantier le plus transverse à ce jour (canal 1) : un grand-livre VIVANT par
lot, qui centralise foncier + bureau d'études (BE, figés une fois pour
toutes) + construction (mécanisme `Devis`/`DevisAjustement` déjà existant,
inchangé) + bureau de contrôle (BC, s'accumule progressivement au fil des
missions). **Découpé en deux sous-tickets, décision actée avec
l'utilisateur** (même discipline que B-030) :
- **B-035 (ce ticket)** — le grand-livre lui-même (`LotLedger`) : `prix_client`
  fixé manuellement, `foncier_alloue`/`be_alloue` figés en snapshot à la
  création. Marge disponible dérivée, SANS le terme bureau de contrôle (qui
  n'existe pas encore).
- **B-036 (futur)** — `LotBcCharge`, effet de bord sur `create_mission`
  (ticket 012), mécanisme d'alerte jamais bloquant, branchement dans la
  formule de marge de B-035.

## Vérification préalable

**Chaîne `InspectionMission` → jalon_type → Lot, confirmée** (nécessaire pour
B-036, vérifiée maintenant pour ne pas concevoir B-035 dans un angle mort) :
`InspectionMission.work_declaration.milestone.code` donne le `jalon_type`
(`Milestone.code`, recopié du `MilestoneTemplateStep` actif à la création du
lot, tickets 002/008) ; `InspectionMission.work_declaration.milestone.lot`
donne le `Lot`. L'effet de bord de B-036 pourra s'accrocher exactement là où
`process_mission_assigned.delay(...)` est déjà déclenché dans
`apps.inspections.services.create_mission`.

**Aucune fonction existante ne calcule le montant construction courant ni ne
retourne le devis verrouillé d'un lot** — `apps.procurement.services.
available_margin(devis)` calcule une grandeur DIFFÉRENTE (la marge KEYIMMO
sur UN devis, `marge_estimee - Σécarts`), pas le montant construction
lui-même. `is_lot_locked(lot_id)` ne retourne qu'un booléen, jamais l'objet.
Ce ticket ajoute les deux fonctions manquantes.

## Décisions de conception actées

**A. `LotLedger`, `apps/procurement`** — prolongement naturel du domaine déjà
propriétaire de `Devis`/`DevisAjustement`, pas un nouveau domaine. Rattaché à
un `Lot` dont le `Devis` construction est DÉJÀ verrouillé (précondition de
création) — `admin_keyimmo` n'étant structurellement pas membre de
l'organisation du lot, même schéma de bascule RLS explicite que
`create_devis` : `organization`/`target_organization_id` fourni
EXPLICITEMENT par l'appelant.

**B. `lot` en `OneToOneField`, pas une simple FK** — au plus UN grand-livre
par lot, garanti par une contrainte `UNIQUE` réelle en base (même principe
que `ActiveLegalPaymentTierTemplate.country_pack`, ticket B-027, décision
D-bis) — pas seulement une vérification applicative. Tentative de création
concurrente : `get()` initial, `create()` sous `transaction.atomic()`,
rattrapage explicite d'`IntegrityError` (même discipline anti-course que
`_get_or_create_task`, ticket 017 — repris ici par cohérence, même si le
risque de concurrence réelle reste faible pour un geste manuel d'admin).

**C. AUCUNE colonne `sequence`** — contrairement à `PricingConfig`/
`ProgramCost`/`ControlOfficeRate` (entités VERSIONNÉES, plusieurs révisions
dans le temps), `LotLedger` n'a par construction QU'UNE SEULE ligne par lot
(décision B) : aucune ambiguïté de tri à départager entre plusieurs
enregistrements pour le même lot, le tie-break `sequence` n'a pas de sens
ici. Immuable après création — même niveau que `Devis`/`ProgramCost`
(policies RLS `SELECT`/`INSERT` scopées organisation, aucune policy
`UPDATE`/`DELETE`).

**D. Précondition de création : le `Devis` du lot doit être VERROUILLÉ** —
cohérent avec la logique VEFA (tout se construit sur des devis/contrats
estimés) : créer un grand-livre avant la sélection du constructeur n'aurait
aucun sens (`construction_courante` serait indéfinie). Refusé explicitement
(erreur dédiée, même famille que `LotAlreadyLockedError`/
`NoPricingConfigError`, 409) si le lot n'a pas encore de devis verrouillé —
aucune ligne créée.

**E. `foncier_alloue`/`be_alloue` — snapshot IMMÉDIAT depuis
`compute_lot_repartition` (ticket B-033), jamais recalculé après.** Réutilise
directement le calcul déjà existant (`apps.programs.services.
compute_lot_repartition`), lit la ligne correspondant à CE lot dans le
résultat, copie ses deux valeurs dans `LotLedger` au moment de la création —
si `ProgramCost`/la méthode de répartition changent ensuite, ce grand-livre
n'en est PLUS jamais affecté (cohérent avec la doctrine « figé une fois pour
toutes » de la décision utilisateur).

**F. Marge disponible — fonction de service dédiée, jamais stockée, formule
VOLONTAIREMENT INCOMPLÈTE dans ce ticket.** `get_lot_ledger_margin(ledger)` =
`prix_client - foncier_alloue - be_alloue - construction_courante` —
`construction_courante` = `devis.amount + Σ(DevisAjustement.ecart signé)` du
devis verrouillé du lot (signe déjà établi au ticket 023 : positif =
surcoût, réduit la marge). **Le terme bureau de contrôle est ABSENT de cette
formule dans ce ticket** — B-036 l'ajoutera (`- ΣLotBcCharge`), documenté
explicitement comme un TODO nommé dans le code, pas une omission silencieuse.

## Entités touchées

**`LotLedger`** (`apps/procurement/models.py`) :
- `id` (UUID)
- `organization` (FK `Organization`, `CASCADE` — dénormalisé depuis
  `lot.organization`)
- `lot` (`OneToOneField` `Lot`, `PROTECT` — décision B)
- `prix_client` (`DecimalField`, saisi manuellement par `admin_keyimmo`)
- `foncier_alloue` (`DecimalField`, snapshot — décision E)
- `be_alloue` (`DecimalField`, snapshot — décision E)
- `created_by` (FK `User`, `PROTECT`)
- `created_at` (auto)

**Nouvelles fonctions de service** :
- `apps.procurement.services.get_locked_devis_for_lot(lot_id)` — retourne
  l'objet `Devis` verrouillé du lot, `None` si aucun (même itération que
  `is_lot_locked`, juste retourne l'objet plutôt qu'un booléen).
- `apps.procurement.services.get_construction_amount(devis)` —
  `devis.amount + Σ(ajustements.ecart)`.
- `apps.procurement.services.create_lot_ledger(...)` — bascule RLS,
  précondition devis verrouillé (décision D), snapshot foncier/BE
  (décision E), garantie anti-course (décision B).
- `apps.procurement.services.get_lot_ledger_margin(ledger)` — décision F,
  formule incomplète documentée.

## Scope inclus

- `LotLedger` + migration (modèle, RLS, contrainte `OneToOneField`).
- Les 4 fonctions de service ci-dessus.
- Endpoints, tous `admin_keyimmo` uniquement :
  - `POST /api/procurement/lot-ledgers/` — création (`organization`, `lot`,
    `prix_client` dans le corps).
  - `GET /api/procurement/lot-ledgers/{lot_id}/?organization_id=<id>` —
    lecture du grand-livre d'un lot.
  - `GET /api/procurement/lot-ledgers/{lot_id}/margin/?organization_id=<id>`
    — marge disponible courante (formule incomplète, décision F).

## Explicitement hors scope

- **`LotBcCharge`, effet de bord sur `create_mission`, mécanisme d'alerte**
  — ticket B-036, sous-ticket suivant.
- **Terme bureau de contrôle dans la formule de marge** — décision F,
  ajouté par B-036.
- **Toute révision/modification d'un `LotLedger` existant** — immuable dès
  ce ticket (décision C), jamais un besoin de révision identifié pour
  `prix_client`/le snapshot foncier/BE eux-mêmes (contrairement à
  `PricingConfig`/`ProgramCost`, qui changent légitimement dans le temps).
- **Toute UI.**

## Critères d'acceptation

- [x] `admin_keyimmo` peut créer un `LotLedger` pour un lot dont il n'est PAS
      membre (bascule RLS), UNIQUEMENT si le `Devis` du lot est déjà
      verrouillé ; tout autre rôle → 403.
      (`TestLotLedgerCreation::test_admin_keyimmo_can_create_a_lot_ledger_once_devis_is_locked`,
      `test_a_constructeur_cannot_create_a_lot_ledger`)
- [x] Créer un `LotLedger` pour un lot SANS devis verrouillé → refusé
      explicitement (409), aucune ligne créée.
      (`test_creation_without_a_locked_devis_is_rejected_and_creates_no_row`)
- [x] Un second `LotLedger` pour un lot qui en a déjà un → refusé
      explicitement, garanti par la contrainte `UNIQUE` en base (testé par
      une tentative SQL brute qui la violerait directement, pas seulement
      une vérification applicative).
      (`test_a_second_ledger_for_the_same_lot_via_the_api_is_rejected`,
      `test_direct_db_insert_bypassing_the_service_violates_the_unique_constraint`)
- [x] `foncier_alloue`/`be_alloue` correspondent EXACTEMENT à la ligne de ce
      lot dans `compute_lot_repartition` au moment de la création — testé
      avec `prorata_surface` ET `parts_egales`.
      (`TestLotLedgerSnapshot::test_snapshot_matches_repartition_with_parts_egales_across_two_lots`,
      `test_snapshot_matches_repartition_with_prorata_surface`)
- [x] Un changement de `ProgramCost` (nouvelle révision) APRÈS la création
      d'un `LotLedger` ne modifie JAMAIS `foncier_alloue`/`be_alloue` de ce
      grand-livre — snapshot prouvé figé, pas juste documenté.
      (`test_a_later_program_cost_revision_never_changes_an_already_created_snapshot`)
- [x] `get_lot_ledger_margin` retourne `prix_client - foncier_alloue -
      be_alloue - construction_courante`, testé avec au moins un
      `DevisAjustement` accepté sur le devis (preuve que
      `construction_courante` n'est pas juste `devis.amount` seul).
      (`TestLotLedgerMargin::test_margin_equals_prix_client_minus_foncier_be_minus_construction_amount`)
- [x] `LotLedger` est immuable après création — aucune policy RLS
      `UPDATE`/`DELETE`, testée comme une tentative EXPLICITE refusée (SQL
      brut, `rowcount == 0`), pas seulement une absence de route ; aucune
      fonction `update`/`delete` dans `services.py` (`hasattr`).
      (`TestLotLedgerImmutability`, 3 tests)
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits
      avant de considérer le ticket terminé — y compris une note explicite
      dans `CLAUDE.md` adressée à B-036, pour que la session qui
      l'implémentera sache exactement où brancher `LotBcCharge` et comment
      étendre `get_lot_ledger_margin`.

## Notes d'implémentation

**Frontière inter-app respectée** : `apps.procurement.services` n'accède
JAMAIS directement à `ProgramCost` — le snapshot foncier/BE passe
exclusivement par `apps.programs.services.compute_lot_repartition`, appelé
avec `admin_organization_id=target_organization_id` (identité volontaire :
la bascule RLS interne de `compute_lot_repartition` devient un no-op,
puisque `create_lot_ledger` a déjà basculé le contexte vers la même
organisation juste avant). Même discipline de frontière que
`get_active_control_office_rate` (ticket B-034, seule source de vérité).

**Anti-course à deux niveaux, pas un seul** — une vérification applicative
préalable (`LotLedger.objects.filter(lot=lot).exists()`, message clair,
rapide dans le cas courant) PUIS un rattrapage `IntegrityError` autour du
`create()` (garantie réelle sous concurrence, la contrainte `UNIQUE` du
`OneToOneField` tranche) : les deux lèvent la MÊME exception
(`LotLedgerAlreadyExistsError`), le second niveau ne sert qu'en cas de
course entre la vérification et l'écriture — décision B du ticket,
confirmée par `test_direct_db_insert_bypassing_the_service_violates_the_unique_constraint`.

**`get_lot_ledger_margin`/`get_construction_amount` construits comme des
lectures « à la volée sans bascule », même discipline que `available_margin`**
(ticket 023) — appelées uniquement depuis des points déjà basculés
(`create_lot_ledger` en écriture, `get_lot_ledger_margin_for_lot` en
lecture) : aucune de ces deux fonctions ne bascule elle-même le contexte
RLS, contrairement à `get_lot_ledger`/`create_lot_ledger` qui, eux,
possèdent leur propre bascule complète (bornes de la responsabilité déjà
établies dans ce module).

**Aucune anomalie trouvée en écrivant les tests** — contrairement à B-029/
B-033, ce ticket n'a pas révélé de piège RLS imprévu : le piège
`get_devis_lot_detail`/`compute_lot_repartition` (lire `lot.asset` sous le
mauvais contexte RLS) était déjà connu et anticipé dès la conception des
helpers de test (`_seed_program_cost_for_lot`, bascule RLS explicite
documentée avant la lecture de `lot.asset.program_id`).

17 tests dédiés, suite `procurement` 71 tests, suite complète du projet 339
tests, tous verts.
