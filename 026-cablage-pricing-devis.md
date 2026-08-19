# Ticket 026 — Câblage PricingConfig ↔ création de Devis

## Statut

**Livré.** Backend/API uniquement (aucune interface utilisateur, comme prévu).
49/49 tests `apps/procurement` + `apps/pricing` verts.

**Note factuelle** : la justification donnée pour le point D cite un « invariant
25.10 » dans `CLAUDE.md` — recherché explicitement, `CLAUDE.md` ne contient que
l'**Invariant 25.6** (Task Inbox, ticket 006 — attribution KEYIMMO). Aucun 25.10
trouvé. Ceci ne change rien à la décision D elle-même (le raisonnement — aucun calcul
métier injectable depuis l'extérieur — tient indépendamment de sa numérotation) ; noté
pour que la référence reste exacte si citée ailleurs.

## Décisions de conception actées

**A. `country_pack` du LOT, pas du candidat** — `devis.organization.country_pack`
gouverne le taux appliqué. Le `country_pack` de `candidate_organization` n'intervient
JAMAIS dans cette dérivation.

**B. Canal `canal_1_marge` uniquement** — seule correspondance directe avec
`Devis.marge_estimee`. `canal_2_commission` n'est touché par aucun mécanisme de ce
ticket (aucun champ `Devis` équivalent n'existe).

**C. Blocage explicite si aucun taux actif** — nouvelle exception
`NoPricingConfigError`, levée par `apps.procurement.services.create_devis` AVANT toute
écriture (aucune ligne `Devis` créée). Vue : 409, même sémantique que
`LotAlreadyLockedError` (ticket 022) — l'état du système (absence de configuration),
pas le corps de la requête, rend l'opération impossible.

**D. `marge_estimee` entièrement dérivé — AUCUN override possible, même par
`admin_keyimmo`** (version la plus stricte, confirmée explicitement) — cohérent avec
le principe qu'aucun calcul métier ne doit pouvoir être injecté depuis l'extérieur.
`DevisCreateSerializer` (ticket 024) perd son champ d'entrée `marge_estimee` — un
`marge_estimee` envoyé dans le payload de `POST /api/pricing/devis/` est **ignoré
silencieusement par le serializer** (champ retiré de `Meta.fields`, jamais lu), pas
une erreur de validation dédiée : cohérent avec le comportement standard d'un
serializer DRF dont un champ n'existe simplement plus en entrée — un client qui
enverrait encore ce champ (code non mis à jour) ne casse rien, il est juste ignoré,
exactement comme n'importe quel champ non déclaré posté à une API DRF.

**Conséquence assumée sur les tests existants (ticket 024)** — pas un contournement,
documenté explicitement comme faisant partie du scope de CE ticket : chaque test qui
appelle `services.create_devis(..., marge_estimee=...)` ou poste `marge_estimee` dans
`DevisCreateSerializer` doit être réécrit pour créer d'abord un `PricingConfig`
`canal_1_marge` actif (via `apps.pricing.services.create_pricing_config`) dans le
`country_pack` du sponsor, PUIS appeler `create_devis` SANS ce paramètre — le taux
attendu dans les assertions devient celui posé par ce `PricingConfig`, plus une valeur
arbitraire choisie dans le test. Périmètre : `apps/procurement/tests.py` uniquement
(les entités elles-mêmes, `Devis`/`DevisAjustement`, ne changent pas).

## Objectif

À la création d'un `Devis`, `marge_estimee` se dérive AUTOMATIQUEMENT et
EXCLUSIVEMENT du dernier `PricingConfig` `canal_1_marge` actif pour le `country_pack`
du LOT — bloqué explicitement (409) si aucun n'existe, jamais un champ vide ni une
valeur par défaut.

**Formule** (précisée après un bug réel trouvé au premier lancement des tests, voir
« Limite assumée » ci-dessous) : `marge_estimee = amount × (rate / 100)`. `rate`
(`PricingConfig`, ticket 025) est un POURCENTAGE (ex. `12.50` pour 12,50 %,
`max_digits=5`) ; une affectation directe `marge_estimee = rate` est
dimensionnellement fausse et débordait littéralement le champ en base dès qu'un
montant à 5 chiffres était testé. Arrondi à 2 décimales, `ROUND_HALF_UP` (arrondi
commercial explicite).

## Limite assumée

**`amount` (le montant du devis, ticket 022) n'a jamais été précisément défini dans
ce projet** — aucune docstring sur le champ, le ticket 022 d'origine dit seulement
« un montant ». Les tickets 023 à 025 ont utilisé la formulation « montant de
construction estimé » comme reformulation non vérifiée, jamais confirmée contre une
source. Confirmé avec l'utilisateur avant d'implémenter ce ticket : `rate` s'applique
DIRECTEMENT à `amount` (l'offre de construction du candidat gagnant) pour cette
itération — pas à un coût de revient total.

**Conséquences explicites, à lever par un futur ticket** :
- Cette formule approxime la marge sur le SEUL poste construction (`amount`), pas sur
  le coût de revient total (foncier + construction + bureau d'études + bureau de
  contrôle) tel que décrit dans le modèle économique de référence pour le **canal 1**
  (programme structuré par KEYIMMO, marge ≈ 18 % de la valeur totale de la
  transaction dans l'exemple chiffré de ce modèle).
- Un futur ticket devra introduire l'agrégation complète des coûts (nouveaux champs
  foncier/BE/BC, probablement un `prix_client` de référence) pour que le canal 1
  reflète fidèlement ce modèle.
- Cette approximation reste cohérente et suffisante pour le **canal 2** (frais +
  commission sur prestations orchestrées, sans prix de cession global fixé par
  KEYIMMO) — mais `canal_2_commission` est de toute façon hors scope de ce ticket
  (point B).

## Dépendances

- **Ticket 022/024** (`Devis.marge_estimee`, `create_devis`,
  `DevisCreateSerializer`) — le point d'intégration, modifié par ce ticket.
- **Ticket 025** (`PricingConfig`, `apps.pricing.services`) — la source du taux,
  étendue par ce ticket (nouvelle fonction), jamais modifiée dans son comportement
  existant.

## Entités touchées

- **`apps/pricing/services.py`** — nouvelle fonction `get_active_rate(*,
  country_pack_id, canal)` → `PricingConfig | None` (le dernier enregistrement pour ce
  couple, ou `None` si aucun). Extraction dédiée, distincte de `get_current_rates`
  (qui retourne les DEUX canaux, pensée pour un affichage `GET .../current/`, pas pour
  ce cas d'usage de dérivation unitaire) — `get_current_rates` n'est PAS réutilisée
  telle quelle ici, mais sa logique de base (`.order_by(*LATEST_FIRST_ORDERING).first()`)
  l'est, factorisée si pertinent au moment d'implémenter.
- **`apps/procurement/services.py`** :
  - `create_devis`/`_create_devis_row` — signature modifiée : **retire le paramètre
    `marge_estimee`**, ajoute un appel à `apps.pricing.services.get_active_rate` pour
    le dériver. Lève `NoPricingConfigError` si `None`.
  - Nouvelle exception `NoPricingConfigError` (même fichier, même famille que
    `LotAlreadyLockedError`).
- **`apps/procurement/serializers.py::DevisCreateSerializer`** — retire le champ
  `marge_estimee` (ajouté au ticket 024).
- **`apps/procurement/views.py::DevisCreateView`** — capture `NoPricingConfigError`,
  renvoie 409.
- **`apps/procurement/tests.py`** — tests existants du ticket 024 mis à jour (voir
  « Conséquence assumée » ci-dessus) + nouveaux tests de ce ticket.

## Scope inclus

- Dérivation automatique de `marge_estimee` à la création d'un `Devis`, depuis
  `PricingConfig` (`canal_1_marge`, `country_pack` du lot).
- Blocage explicite (409, `NoPricingConfigError`) si aucun `PricingConfig`
  `canal_1_marge` actif n'existe pour ce `country_pack` — aucune ligne `Devis` créée.
- Retrait complet de `marge_estimee` comme champ d'entrée de l'API de création de
  devis — aucun override possible, même par `admin_keyimmo`.

## Explicitement hors scope

- `canal_2_commission` (point B) — aucun mécanisme, aucun champ `Devis` concerné.
- Toute modification du flux de verrouillage (`lock_devis`) ou de réconciliation
  (`create_ajustement`, ticket 024) — tous deux inchangés, ils opèrent sur
  `marge_estimee` déjà posé à la création, peu importe sa provenance (dérivée
  désormais, mais le mécanisme de lecture en aval ne change pas).
- Toute UI.
- Un changement de taux `PricingConfig` en cours de vie d'un `Devis` — un `Devis` déjà
  créé garde son `marge_estimee` d'origine pour toujours (immutabilité déjà actée au
  ticket 024), un changement de taux ultérieur n'affecte QUE les futurs `Devis`.

## Critères d'acceptation

- [x] Créer un `Devis` alors qu'un `PricingConfig` `canal_1_marge` actif existe pour
      le `country_pack` du lot pré-remplit `marge_estimee` avec CE taux — sans que le
      client ne le fournisse.
- [x] Créer un `Devis` alors qu'AUCUN `PricingConfig` `canal_1_marge` n'existe encore
      pour ce `country_pack` échoue explicitement (409, `NoPricingConfigError`) —
      aucune ligne créée.
- [x] Un `marge_estimee` envoyé dans le payload de création est ignoré (pas une
      erreur) — le taux effectivement posé sur le `Devis` créé reste celui dérivé du
      `PricingConfig`, jamais la valeur envoyée par le client, testé avec une valeur
      délibérément différente pour le prouver sans ambiguïté.
- [x] Le `country_pack` déterminant est celui de `devis.organization` (le lot) —
      testé avec un candidat dont le `country_pack` diffère de celui du lot, le taux
      appliqué reste celui du country_pack du LOT.
- [x] Un changement de taux `PricingConfig` APRÈS la création d'un `Devis` ne modifie
      jamais son `marge_estimee` déjà posé (non-régression directe de l'immutabilité
      actée au ticket 024).
- [x] Tests du ticket 024 mis à jour pour créer un `PricingConfig` de fixture plutôt
      que de passer `marge_estimee` manuellement — documentés comme conséquence
      assumée de ce ticket (pas un contournement).
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits avant de
      considérer le ticket terminé.

## Notes d'implémentation

**Fichiers touchés** : `apps/pricing/services.py` (`get_active_rate`,
`get_current_rates` refactorée pour le réutiliser), `apps/procurement/services.py`
(`NoPricingConfigError`, `_derive_marge_estimee`, `create_devis`/`_create_devis_row`
modifiés), `apps/procurement/serializers.py` (`DevisCreateSerializer` sans
`marge_estimee`), `apps/procurement/views.py` (`DevisCreateView` capture
`NoPricingConfigError` → 409), `apps/procurement/tests.py` (tests du ticket 024
réécrits + nouveaux tests de ce ticket), `CLAUDE.md`, ce fichier.

**Bug réel trouvé au tout premier lancement des tests, pas anticipé par le brouillon
du ticket** : la formule initiale (`marge_estimee = active_rate.rate`, copie directe)
a fait échouer la toute première tentative de création avec une `DataError`
PostgreSQL — `PricingConfig.rate` (`max_digits=5`, dimensionné pour un POURCENTAGE,
ticket 025) ne peut physiquement pas contenir un montant à 5 chiffres. Ce n'était pas
qu'un problème de taille de champ : la formule elle-même était dimensionnellement
fausse (confondait un taux en % avec un montant absolu). Corrigé en introduisant
`_derive_marge_estimee(amount, rate_percent) = amount × (rate_percent / 100)`,
arrondi `ROUND_HALF_UP` à 2 décimales — voir aussi la section « Limite assumée »
ci-dessus pour la question de fond que ce bug a fait émerger (que représente
réellement `amount` ?), tranchée avec l'utilisateur avant de corriger.

**Tests de cas limite construits pour tomber sur des nombres ronds, pas pour
dépendre de la formule de production** : `BOUNDARY_TEST_AMOUNT` (100000.00) ×
`PRICING_RATE_PERCENT` (10 %) = `EXPECTED_MARGE_FOR_BOUNDARY_TESTS` (10000.00) EXACT
— choisi délibérément pour que `TestDevisAjustementBoundaryCase`/
`TestDevisAjustementCumulativeSigned` réutilisent l'arithmétique déjà écrite au
ticket 023 (+50000, -1000, +0,01) sans avoir à la recalculer, et pour que la preuve
du cas limite exact ne dépende PAS de la même formule que celle testée
(`_derive_marge_estimee`) — une preuve indépendante par construction, pas une
tautologie. `TestPricingConfigWiring::
test_marge_estimee_is_derived_from_amount_times_the_active_rate` calcule lui aussi
son attente à la main (`123456.78 × 10 % = 12345.678` → `12345.68`), jamais via
`_expected_marge` (qui appelle la même formule que la production, utile pour les
assertions de plomberie, pas pour prouver l'arithmétique elle-même).

**Conséquence assumée sur les tests du ticket 024, comme prévu** : `MARGE_A`/
`MARGE_B` (constantes individuelles par devis) retirées, remplacées par
`PRICING_RATE_PERCENT` (le taux seedé par défaut dans `_setup_lot_up_for_bid`,
partagé par tous les devis d'un country_pack) et `_expected_marge()` (helper de
test réutilisant la formule de production pour les assertions qui n'ont pas besoin
d'un résultat rond). `seed_pricing=False` ajouté à `_setup_lot_up_for_bid` pour le
seul test qui vérifie explicitement le blocage sans configuration active.

**Suite** : 49/49 tests `apps/procurement` + `apps/pricing`. Suite backend complète
relancée après implémentation pour confirmer l'absence de régression ailleurs — voir
résultat rapporté à l'utilisateur.
