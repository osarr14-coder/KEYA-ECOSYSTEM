# Ticket B-036 — Charges bureau de contrôle (canal 1), second sous-ticket

## Statut

**Implémenté, testé, documenté.** 14 tests dédiés
(`apps/procurement/tests.py`) + 3 tests de garde (`apps/pricing/tests.py`),
suite `procurement` 85 tests, suite `pricing` 59 tests, tous verts.

## Origine

Suite directe de **B-035** (grand-livre de coûts par lot, fusionné dans
`master`). B-035 a construit le grand-livre lui-même (`LotLedger` :
`prix_client`, `foncier_alloue`/`be_alloue` figés) avec une formule de
marge VOLONTAIREMENT INCOMPLÈTE (`get_lot_ledger_margin`, TODO nommé dans
le code) — ce ticket ferme cette dette : chaque `InspectionMission`
(ticket 012) génère automatiquement une charge bureau de contrôle (BC),
qui vient s'ajouter à la formule de marge.

## Décisions déjà tranchées (rappel, non renégociables)

1. Chaque `InspectionMission` génère automatiquement une `LotBcCharge` via
   `get_active_control_office_rate` (B-034) pour son `jalon_type` — effet
   de bord à la création de la mission, même pattern que `Task` créée en
   effet de bord d'une `Reserve` (ticket 006).
2. Mode `percentage`/« global » : se déclenche AU PLUS UNE FOIS PAR LOT, à
   la première mission pour laquelle aucune entrée `fixed_amount` n'existe
   pour son `jalon_type` précis — jamais répété aux missions suivantes du
   même lot.
3. La création d'une charge BC n'est JAMAIS bloquée par la marge
   disponible — une `Task` `ALERT` se déclenche si la marge passe sous
   zéro, jamais un blocage de la mission.

## Vérification préalable

**Chaîne de hook confirmée** : `apps.inspections.services.create_mission`
(`_create_mission_row(...)` puis `finally: set_rls_context(admin_org)`) —
le point d'insertion est À L'INTÉRIEUR du `try:`, APRÈS
`mission = _create_mission_row(...)`, AVANT le `finally` : la bascule RLS
vers l'organisation cible (celle du lot) est encore active à cet endroit,
exactement comme `Task` pour `Reserve` (ticket 006)/`DevisAjustement`
refusé (ticket 024).

**Aucun cycle d'import** : `apps.procurement` n'est importé nulle part
dans `apps.inspections`, et réciproquement `apps.inspections.models`
n'importe rien de `apps.procurement` — un import différé (niveau fonction,
même style que `from apps.tasks.tasks import process_mission_assigned`
déjà présent dans `create_mission`) suffit, aucun souci de dépendance
circulaire.

**Aucune collision de jalon** : `'global'` (valeur candidate pour la
référence réservée, décision B ci-dessous) n'apparaît dans aucun jalon
réel seedé (`apps/programs/migrations/0003_seed_senegal_milestone_template.py` :
`foncier`, `conception`, `fondations`, `gros_oeuvre`, `second_oeuvre`,
`finitions`, `reception`, `livraison`).

## Décisions de conception proposées

**A. `LotBcCharge.lot` en FK DIRECTE vers `Lot`, PAS vers `LotLedger`.**
Une charge BC doit TOUJOURS pouvoir être enregistrée (décision 3,
indépendance du contrôle) — y compris pour un lot dont le grand-livre
n'existe pas ENCORE (le devis construction peut être verrouillé sans que
`admin_keyimmo` ait déjà posé `prix_client`, geste manuel distinct,
B-035). Une FK vers `LotLedger` aurait forcé une précondition
d'existence du grand-livre, contredisant directement la décision 3.
Conséquence : la marge (`get_lot_ledger_margin`) reste indéfinie tant
qu'aucun `LotLedger` n'existe, mais les charges BC, elles, s'accumulent
dès la première mission, quel que soit l'état du grand-livre.

**B. `GLOBAL_CONTROL_OFFICE_JALON_TYPE = 'global'`, constante réservée
dans `apps.pricing.services` (PAS `apps.procurement`, révisé — voir C-bis
ci-dessous).** `jalon_type` reste un `CharField` LIBRE au niveau du
modèle `ControlOfficeRate` (aucun changement de schéma sur B-034) — mais
la VALIDATION à la création, elle, doit désormais connaître cette valeur
réservée (décision C-bis), ce qui déplace la constante dans `apps.pricing`
plutôt que `apps.procurement` : `apps.procurement.services` importe déjà
`apps.pricing.services`/`apps.pricing.models` (`get_active_rate`,
`PricingCanal`), jamais l'inverse — placer la constante dans
`apps.pricing` évite tout risque de cycle d'import, `apps.procurement` se
contente de l'importer au lieu de la redéfinir.

**C. Confirmé — une entrée `percentage` créée pour un `jalon_type` RÉEL
(pas la valeur réservée) n'aurait jamais eu d'effet.** Conséquence directe
de la décision 2 (« restreint à UNE SEULE référence globale ») : la
recherche de taux applicable à une mission vérifie UNIQUEMENT
« existe-t-il une entrée `fixed_amount` pour ce `jalon_type` précis ? »
— une entrée `percentage` sur un `jalon_type` réel n'y répond jamais.

**C-bis. Garde à la création (B-034,
`apps.pricing.services.create_control_office_rate`) : `calculation_mode
= 'percentage'` ET `jalon_type != GLOBAL_CONTROL_OFFICE_JALON_TYPE` →
refus explicite, aucune ligne créée.** Décision de l'utilisateur suite à
C : plutôt qu'un silence en aval (une entrée acceptée mais jamais
consommée par B-036), un refus explicite à la source — même discipline
que la garde `is_active` (B-032) ou la contrainte mutuelle
`percentage`/`fixed_amount` déjà posée par B-034 lui-même. Levée comme
`django.core.exceptions.ValidationError({'jalon_type': ...})` — même
famille que les deux vérifications déjà présentes dans cette fonction
(mode `percentage`/`fixed_amount` mutuellement exclusifs) — PAS une
exception dédiée supplémentaire : `ControlOfficeRateCreateView` capture
déjà génériquement `DjangoValidationError` → 400, aucune modification de
la vue nécessaire. 400, pas 409 : un problème de FORME de la requête
elle-même (un `jalon_type` incompatible avec le mode choisi), jamais un
conflit d'état. Vérifiée APRÈS la garde `is_active` existante, DANS la
branche `percentage` de la vérification mutuelle déjà présente (le plus
tôt possible dans le chemin déjà emprunté par ce mode).

**D. `sequence` construit DÈS LA CONCEPTION** (leçon B-031/B-033/B-034) —
même si une vraie collision est peu probable ici (chaque `LotBcCharge`
provient d'une requête HTTP distincte de création de mission, pas de deux
écritures dans la MÊME transaction comme le flake originel), la discipline
du projet est de ne jamais s'appuyer sur `-created_at` seul dès qu'un tri
chronologique existe (liste des charges d'un lot). `LATEST_FIRST_ORDERING`
+ tri chronologique inverse pour la liste, comme `ProgramCost`.

**E. Suivi de consommation de l'entrée globale : par REQUÊTE sur
`LotBcCharge.is_global_reference`, PAS un champ dédié sur `Lot`/
`LotLedger`.** `is_global_reference` (booléen) marque la charge issue du
mode global — « déjà consommé pour ce lot » =
`LotBcCharge.objects.filter(lot=lot, is_global_reference=True).exists()`.
Choix explicite (vous aviez laissé ce point ouvert) : évite un nouveau
champ mutable sur `Lot`/`LotLedger` (qui casserait leur immutabilité/
stabilité de schéma respectives) — la trace elle-même EST la preuve de
consommation, auditable directement dans l'historique du grand-livre.

**F. `record_bc_charge_for_mission(*, mission, actor)` — appelée
SYNCHRONEMENT, DANS le même bloc `transaction.atomic()` et sous la MÊME
bascule RLS que la création de la mission elle-même, jamais `.delay()`'d.**
Une charge BC perdue/retardée corromprait irrémédiablement le calcul de
marge du grand-livre — contrairement à `Task` (notification, effet de
bord secondaire), la charge EST une donnée financière de premier ordre.
Ne lève JAMAIS d'exception par conception (voir décision 3) : soit elle
crée une charge, soit elle ne fait rien (`None`) — aucun chemin d'erreur
attendu qui bloquerait la création de la mission.

**G. Confirmé — cas où le devis construction du lot n'est pas encore
verrouillé au moment d'une mission qui tomberait sur le mode global**
(le pourcentage s'applique au montant construction courant,
indéfinissable sans devis verrouillé — `get_construction_amount`, B-035).
AUCUNE charge n'est générée dans ce cas (même traitement que l'absence de
taux configuré — décision 3, jamais un blocage), ET l'entrée globale
N'EST PAS marquée consommée (aucune ligne créée, donc
`is_global_reference=True` n'existe pas encore) — elle reste disponible
pour une mission ultérieure sur ce même lot, une fois le devis verrouillé.
Comportement qui découle naturellement de la décision E, aucun code
supplémentaire nécessaire au-delà de `record_bc_charge_for_mission`
lui-même.

**H. `get_lot_ledger_margin` (B-035) étendue pour soustraire
`Σ LotBcCharge.montant` du lot** — ferme le TODO nommé laissé dans le
code par B-035. Nouvelle formule complète :
`prix_client - foncier_alloue - be_alloue - construction_courante -
Σ LotBcCharge.montant (WHERE lot = ledger.lot)`.

**I. Alerte `ALERT` — réutilise EXACTEMENT le mécanisme de
`create_task_for_devis_ajustement_refuse` (ticket 024)** :
`_get_or_create_task` (dédoublonnage par `(subject_type, subject_id,
source)`, ticket 017), `subject` = le `LotLedger` (pas la charge ni le
lot — c'est la marge du GRAND-LIVRE qui est en alerte), `source` =
`'lot_ledger_margin_negative'`, `type=TaskType.ALERT`,
`priority=TaskPriority.HIGH`, `assignee=actor` (l'admin qui vient de
créer la mission — auto-assignation, même raisonnement que le ticket 024 :
c'est lui qui a l'action de vérifier). **Limite héritée, pas nouvelle** :
la contrainte `UniqueConstraint(['subject_type', 'subject_id', 'source'])`
sur `Task` n'est PAS scopée par statut — une fois une première alerte
créée puis marquée `DONE`, une DEUXIÈME dérive de marge ultérieure sur le
MÊME grand-livre ne générera PAS de nouvelle alerte (`_get_or_create_task`
retrouve l'ancienne, déjà traitée, silencieusement). Comportement déjà
présent pour `DevisAjustement` refusé (ticket 024), pas une régression
introduite ici — signalé pour transparence, hors scope de correction dans
ce ticket.

**J. Nouvel endpoint de lecture** : `GET
/api/procurement/lot-ledgers/{lot_id}/bc-charges/?organization_id=<id>`
— historique complet des charges BC d'un lot, chronologique, réservé
`admin_keyimmo`. Complète la transparence du grand-livre (B-035 exposait
déjà le ledger lui-même et sa marge ; les charges qui la composent
restaient jusqu'ici invisibles depuis l'API).

## Entités touchées

**`LotBcCharge`** (`apps/procurement/models.py`) :
- `id` (UUID)
- `organization` (FK `Organization`, `CASCADE` — dénormalisé depuis
  `lot.organization`)
- `lot` (FK `Lot`, `PROTECT`, `related_name='bc_charges'` — décision A)
- `mission` (`OneToOneField` `InspectionMission`, `PROTECT`,
  `related_name='bc_charge'` — au plus une charge par mission, garantie
  DB ; `null` implicite au niveau ligne : une mission peut simplement
  n'avoir AUCUNE ligne associée, décision 3/G)
- `jalon_type` (`CharField`, snapshot du jalon de la mission au moment de
  la charge — jamais une FK, même raisonnement que `ControlOfficeRate`)
- `montant` (`DecimalField`)
- `is_global_reference` (`BooleanField`, `default=False` — décision E)
- `created_by` (FK `User`, `PROTECT` — l'acteur qui a créé la mission)
- `created_at` (auto)
- `sequence` (`BigIntegerField`, `unique=True` — décision D)

Append-only, immuable après création — RLS `SELECT`/`INSERT` scopés
organisation, **aucune policy `UPDATE`/`DELETE`**, même niveau que
`DevisAjustement`/`LotLedger`.

**Modifiée** (`apps/pricing/services.py::create_control_office_rate`,
B-034) — décision C-bis :
- `GLOBAL_CONTROL_OFFICE_JALON_TYPE = 'global'` (décision B, NOUVELLE
  constante de ce module, pas de `apps.procurement`)
- Garde ajoutée : `calculation_mode='percentage'` ET
  `jalon_type != GLOBAL_CONTROL_OFFICE_JALON_TYPE` → `ValidationError`,
  aucune ligne créée.

**Nouvelles fonctions de service** (`apps/procurement/services.py`) :
- `record_bc_charge_for_mission(*, mission, actor)` — décisions A, C, F, G
  (importe `GLOBAL_CONTROL_OFFICE_JALON_TYPE` depuis `apps.pricing.services`)
- `list_bc_charges_for_lot(*, admin_organization_id, target_organization_id, lot_id)`
  — décision J
- `get_lot_ledger_margin` (existante, B-035) — ÉTENDUE, décision H

**Nouvelle fonction/génerateur** (`apps/tasks/services.py`) :
- `LOT_LEDGER_MARGIN_NEGATIVE_SOURCE = 'lot_ledger_margin_negative'`
- `_lot_ledger_margin_negative_label(ledger)` — ajoutée à `LABEL_GENERATORS`
  (couverte automatiquement par `TestNoTaskLabelGeneratorAttributesDecisionToKeyimmo`)
- `create_task_for_lot_ledger_margin_negative(ledger, actor)` — décision I

**Modifiée** (`apps/inspections/services.py::create_mission`) : un appel
différé à `record_bc_charge_for_mission`, ajouté entre
`mission = _create_mission_row(...)` et le `finally:` du bloc
`transaction.atomic()` existant.

## Scope inclus

- Garde à la création `ControlOfficeRate` (décision C-bis, `apps/pricing`).
- `LotBcCharge` + migration (modèle, RLS, `sequence`).
- `record_bc_charge_for_mission` (décisions A, B, C, F, G) et son
  branchement dans `create_mission`.
- Extension de `get_lot_ledger_margin` (décision H).
- Mécanisme d'alerte `ALERT` (décision I).
- `GET /api/procurement/lot-ledgers/{lot_id}/bc-charges/` (décision J).

## Explicitement hors scope

- **Toute modification du SCHÉMA de `ControlOfficeRate` ou de
  `get_active_control_office_rate` elle-même (B-034)** — lue telle quelle,
  deux fois (jalon précis, puis `'global'`), jamais dupliquée. Seule sa
  fonction de CRÉATION (`create_control_office_rate`) gagne une garde
  supplémentaire (décision C-bis) — un ajout, pas une réécriture.
- **Toute modification de `LotLedger` lui-même** (B-035) — seule sa
  fonction de marge dérivée change, jamais son schéma.
- **Correction de la limite d'alerte unique héritée** (décision I) — hors
  scope, signalée pour transparence uniquement.
- **Toute UI.**

## Critères d'acceptation

- [x] `create_control_office_rate` refuse (400, aucune ligne créée) une
      entrée `calculation_mode='percentage'` dont le `jalon_type` diffère
      de `GLOBAL_CONTROL_OFFICE_JALON_TYPE` — testé avec un `jalon_type`
      réel (ex. `'fondations'`) en mode `percentage`. Une entrée
      `calculation_mode='percentage'` avec `jalon_type=GLOBAL_CONTROL_OFFICE_JALON_TYPE`
      reste acceptée (non-régression explicite).
      (`TestControlOfficeRatePercentageJalonTypeGuard`, 3 tests,
      `apps/pricing/tests.py`)
- [x] Créer une `InspectionMission` sur un jalon avec une entrée
      `fixed_amount` correspondante crée une `LotBcCharge` de ce montant —
      répété sur DEUX missions différentes du même jalon (même lot) :
      DEUX charges cumulatives, jamais une seule.
      (`TestLotBcChargeFixedAmount`)
- [x] Créer une `InspectionMission` sur un jalon SANS entrée `fixed_amount`,
      avec une entrée `'global'`/`percentage` active et un devis
      verrouillé : une `LotBcCharge` `is_global_reference=True`, montant =
      `construction_courante × percentage / 100`.
      (`TestLotBcChargeGlobalPercentage::test_first_mission_without_a_fixed_rate_consumes_the_global_entry`)
- [x] Une DEUXIÈME mission sur un AUTRE jalon sans `fixed_amount`, même
      lot : AUCUNE charge générée (`is_global_reference` déjà consommé) —
      prouvé par `LotBcCharge.objects.filter(lot=lot).count()` inchangé.
      (`test_second_mission_on_a_different_jalon_without_fixed_rate_produces_no_charge`)
- [x] Aucune entrée `fixed_amount` NI `'global'` configurée : la mission
      est créée normalement (jamais bloquée), AUCUNE `LotBcCharge` créée.
      (`TestLotBcChargeNoRateConfigured`)
- [x] Mode global applicable mais devis du lot PAS ENCORE verrouillé :
      aucune charge créée, ET l'entrée globale reste disponible pour une
      mission ultérieure une fois le devis verrouillé (testé en verrouillant
      le devis APRÈS la première mission, puis en créant une seconde
      mission sans tarif fixe : celle-ci consomme le global).
      (`TestLotBcChargeDevisNotLockedYet`)
- [x] `get_lot_ledger_margin` reflète la soustraction des `LotBcCharge` —
      testé avec au moins deux charges cumulées (une `fixed_amount`, une
      `global`).
      (`TestLotLedgerMarginIncludesBcCharges`)
- [x] Marge du grand-livre qui passe sous zéro après création d'une
      mission déclenche une `Task` `ALERT` assignée à l'admin qui a créé
      la mission ; la mission elle-même reste créée avec succès (jamais
      un rejet HTTP à cause de la marge).
      (`TestLotBcChargeNegativeMarginAlert`)
- [x] Aucun `LotLedger` n'existe encore pour le lot : la mission ET la
      charge BC sont créées normalement, AUCUNE tentative d'évaluation de
      marge (pas d'exception, pas d'alerte).
      (`TestLotBcChargeWithoutLedger`)
- [x] `LotBcCharge` est immuable après création — même style de preuve
      que `TestLotLedgerImmutability`/`TestDevisImmutability` (SQL brut,
      `rowcount == 0`, plus absence de fonction `update`/`delete`).
      (`TestLotBcChargeImmutability`, 3 tests)
- [x] `record_bc_charge_for_mission` ne lève jamais d'exception dans les
      scénarios ci-dessus — la création de mission ne peut PAS échouer à
      cause d'un état de configuration BC (0 taux, marge négative, devis
      non verrouillé). Prouvé implicitement par TOUS les tests ci-dessus
      (chaque appel à `_create_mission_for_lot` vérifie `status_code ==
      201`, y compris dans les scénarios de configuration BC dégradée).
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits
      avant de considérer le ticket terminé.
- [x] Historique des charges d'un lot (décision J) — `GET .../bc-charges/`,
      chronologique, réservé `admin_keyimmo`, liste vide si aucune charge.
      (`TestLotBcChargeListEndpoint`, 3 tests)

## Notes d'implémentation

**Régression de test évitée AVANT qu'elle ne survienne** : la garde C-bis
(décision de l'utilisateur) rendait invalides 4 tests existants de B-034
(`apps/pricing/tests.py`) qui créaient une entrée `percentage` sur
`SENEGAL_JALON_TYPE = 'fondations'` (un jalon réel, pas la valeur
réservée) — `test_admin_can_create_a_percentage_mode_rate`,
`test_current_returns_the_latest_entry`,
`test_history_returns_every_entry_in_chronological_order`,
`test_two_rates_with_an_identical_created_at_are_resolved_by_sequence`.
Le premier corrigé en changeant son `jalon_type` vers
`GLOBAL_CONTROL_OFFICE_JALON_TYPE` (c'est littéralement ce qu'il teste).
Les trois autres testaient le comportement « la plus récente gagne »/le
tie-break par `sequence` en mélangeant DEUX modes de calcul sur le MÊME
`jalon_type` — l'intention réelle de ces tests (preuve d'ordre, pas de
mode) ne dépend pas du mode de calcul : corrigés en utilisant
`fixed_amount` pour les DEUX révisions plutôt que de changer leur
`jalon_type` (qui aurait cassé le scénario « même jalon, deux
révisions » qu'ils vérifient).

**Anti-course à deux niveaux (décision E), pas la garantie DB de B-035** :
contrairement à `LotLedger` (contrainte `UNIQUE` réelle + rattrapage
`IntegrityError`), la consommation de l'entrée globale n'a AUCUNE
contrainte DB dédiée — `is_global_reference` n'est PAS `unique=True` par
lot (aucune contrainte partielle PostgreSQL posée). Choix assumé : le
risque de concurrence réelle est nul par construction (chaque charge
provient d'un appel SYNCHRONE, dans le MÊME bloc `transaction.atomic()`
que la création de sa mission — deux missions ne peuvent jamais être
créées "en même temps" au sens SQL pour le MÊME lot sans deux requêtes
HTTP réellement concurrentes, un cas non couvert par ce ticket, cohérent
avec la décision 3 du ticket qui ne mentionne aucune exigence
d'atomicité cross-mission).

**Tests de mission via l'endpoint RÉEL, pas un raccourci `apps.
inspections.services.create_mission` appelé directement** — choix
délibéré (`_create_mission_for_lot`, nouveau helper) : exerce la chaîne
complète vue → service → `record_bc_charge_for_mission`, la garantie la
plus forte que le branchement réel fonctionne, pas seulement la fonction
de service en isolation.

**Aucune anomalie trouvée en écrivant les tests** — le seul point de
friction a été anticipé dès la conception (accès à `lot.asset.program_id`/
`lot.milestones` sous la bonne bascule RLS, piège déjà documenté et
routinier depuis B-029/B-033/B-035).

14 tests dédiés (`apps/procurement/tests.py`) + 3 tests de garde
(`apps/pricing/tests.py`), suite `procurement` 85 tests, suite `pricing`
59 tests, suite complète du projet à confirmer avant fusion.
