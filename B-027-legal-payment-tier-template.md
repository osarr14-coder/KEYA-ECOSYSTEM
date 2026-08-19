# Ticket B-027 — LegalPaymentTierTemplate (section 5 du modèle économique)

## Statut

**Implémenté, testé (33 tests dédiés, suite complète 256 tests verte), documenté —
en attente du feu vert utilisateur pour fusion vers `master`.** Conception tranchée
avec l'utilisateur (points A/B/C/D, plus une correction D-bis sur la garantie DB de
la contrainte « un seul actif »), même discipline que les tickets 012/024/025/026:
décisions actées avant d'écrire le code, pas après. Premier ticket sous la nouvelle
convention de numérotation (`B-`/`F-`, voir `CLAUDE.md`).

## Décisions de conception actées

**A. Plafonds CUMULÉS, pas des incréments** — chaque palier stocke son plafond
cumulé (`cumulative_cap_percent`), ex. Sénégal : 35, 70, 95, **100** (pas 5) pour le
dernier. Cohérent avec le langage du modèle économique lui-même (« plafond cumulé de
son palier ») et permet une garde de non-dépassement par simple comparaison directe,
sans sommer des incréments.

**B. Règle de versement progressif PAR PALIER, pas un champ global sur le
template** — `LegalPaymentTierStep.allows_progressive_payments` (booléen), pas sur
`LegalPaymentTierTemplate`. Un même régime légal peut autoriser des versements
progressifs sur certains paliers et exiger un versement unique sur d'autres — le
champ descend au niveau où l'utilisateur a confirmé que la variation réelle existe.

**C. Couplage LÂCHE avec les jalons de construction** — `LegalPaymentTierStep.code`
est un `CharField` libre (comme `MilestoneTemplateStep.code`), **aucune FK vers
`MilestoneTemplateStep`**. `LegalPaymentTierTemplate` et `MilestoneTemplate` restent
versionnés indépendamment. `MilestoneTemplateStep.weight` (champ de pondération
financière du ticket 002, jamais câblé) reste non câblé après ce ticket aussi —
piste explicitement laissée à un futur ticket séparé sur un lien souple entre les
deux structures, pas construite ici.

**D. Activation EXPLICITE et DISTINCTE de la création** — `created_by`/`created_at`
(la rédaction du brouillon) sont des champs SÉPARÉS de `activated_by`/`activated_at`
(l'activation, l'événement légalement significatif). Un template créé mais jamais
activé est un BROUILLON, invisible de toute résolution d'« actif ». Activer un
nouveau template désactive automatiquement l'ancien actif du même `country_pack`
dans la même opération — **au plus UN template actif par `country_pack` à la fois**,
plus strict que `MilestoneTemplate` (qui tolère plusieurs `is_active=True` en
théorie, aucune contrainte ne l'empêchant).

**D-bis. Garantie « au plus un actif à la fois » : au niveau BASE DE DONNÉES, pas
seulement applicatif (correction actée avant implémentation)** — question posée
explicitement par l'utilisateur : la version initiale de ce ticket ne dérivait
« l'actif » que de `activated_at` sur `LegalPaymentTierTemplate` lui-même, sans
contrainte DB — même classe de risque que la race déjà trouvée et corrigée au
ticket 017 (idempotence des `Task`). Corrigée par **séparation des responsabilités**,
`activated_by`/`activated_at` restent un fait historique PERMANENT (jamais réécrits,
même une fois supplantés — sinon la trace « ce template a été actif du X au Y »
disparaîtrait, ce que ce ticket ne veut justement pas), tandis qu'un nouveau modèle
dédié — `ActiveLegalPaymentTierTemplate`, `country_pack` en `OneToOneField` (Django
pose une vraie contrainte `UNIQUE` en base sur ce type de champ, pas une simple
vérification applicative) — sert de POINTEUR MUTABLE vers le template actuellement
actif. Activer un template fait un upsert de ce pointeur avec la même discipline
anti-race EXPLICITE que `apps.tasks.services._get_or_create_task` (ticket 017) :
`get()` initial, `create()` sous `transaction.atomic()`, rattrapage explicite
d'`IntegrityError` si une activation concurrente a créé le pointeur entre-temps, puis
second `get()` — jamais un `get_or_create()`/`update_or_create()` Django (implémentation
initiale rédigée avec `get_or_create()`, corrigée en cours de rédaction des tests pour
rester cohérente avec la discipline déjà établie au ticket 017 — voir « Notes
d'implémentation »), jamais un retry aveugle. Testé par une race RÉELLE (deux vrais
threads/connexions, `threading.Barrier`), même schéma que
`apps.tasks.tests.py::TestTaskCreationRaceUnderConcurrency`.

## Objectif

Structure de paliers légaux de paiement — nombre de paliers, plafonds cumulés en %,
jalon associé (référence libre), règle de versement progressif par palier —
versionnée par `CountryPack`, jamais codée en dur. **Aucun mouvement de fonds réel** :
ce ticket pose la configuration et sa validation structurelle interne, jamais un
appel de fonds.

## Dépendances

- **Ticket 001** (`CountryPack`) — `LegalPaymentTierTemplate` s'y rattache.
- **Ticket 002** (`MilestoneTemplate`/`MilestoneTemplateStep`) — pattern structurel
  direct réutilisé (parent versionné + enfants ordonnés, `UniqueConstraint`), jamais
  couplé par FK (décision C).
- **Ticket 011** (`IsAdminKeyimmo`) — réutilisée telle quelle pour la création et
  l'activation.

## Entités touchées

Nouvelle app `apps/pricing` (déjà existante, ticket 025) — `LegalPaymentTierTemplate`
partage le même domaine (configuration légale/économique par `CountryPack`) que
`PricingConfig`, pas une nouvelle app.

**`LegalPaymentTierTemplate`** :
- `id` (UUID)
- `country_pack` (FK `CountryPack`, `PROTECT`)
- `version` (`PositiveIntegerField`)
- `created_by` (FK `User`, `PROTECT`), `created_at` (auto)
- `activated_by` (FK `User`, `PROTECT`, **nullable**), `activated_at` (**nullable**) —
  `NULL` tant que le template reste un brouillon (décision D)

Contrainte : `UniqueConstraint(country_pack, version)` (même schéma que
`MilestoneTemplate`).

**`LegalPaymentTierStep`** :
- `id` (UUID)
- `template` (FK `LegalPaymentTierTemplate`, `CASCADE`)
- `order` (`PositiveIntegerField`)
- `code` (`CharField`, libre — décision C)
- `label` (`CharField`)
- `cumulative_cap_percent` (`DecimalField(max_digits=5, decimal_places=2)` — décision A)
- `allows_progressive_payments` (`BooleanField` — décision B)

Contraintes : `UniqueConstraint(template, order)` + `UniqueConstraint(template, code)`
(même schéma que `MilestoneTemplateStep`).

**`ActiveLegalPaymentTierTemplate`** (décision D-bis, pointeur mutable — pas un
enregistrement historique) :
- `country_pack` (`OneToOneField` `CountryPack`, `PROTECT`) — la contrainte `UNIQUE`
  posée par Django sur ce champ EST la garantie « au plus un actif par
  `country_pack » au niveau base de données, pas une vérification applicative.
- `template` (FK `LegalPaymentTierTemplate`, `PROTECT`)
- `updated_at` (auto, `auto_now=True`) — seule trace de « depuis quand ce pointeur
  vaut ce template », volontairement PAS un historique complet (l'historique complet
  vit dans `LegalPaymentTierTemplate.activated_at`, immuable, un par version).

**Aucun champ `is_active` sur `LegalPaymentTierTemplate`** (contrairement à
`MilestoneTemplate`) : l'« actif » se lit désormais dans
`ActiveLegalPaymentTierTemplate`, jamais dérivé d'un tri sur `activated_at` — cohérent
avec la doctrine Visible Trust (jamais stocker ce qui se dérive) ET avec une garantie
DB réelle plutôt qu'une simple convention de lecture.

## Scope inclus

- `LegalPaymentTierTemplate` + `LegalPaymentTierStep` + migrations.
- `POST /api/pricing/legal-payment-tier-templates/` (`admin_keyimmo` uniquement) —
  crée un template BROUILLON avec ses paliers en une seule requête (liste ordonnée de
  paliers dans le payload, pas des appels séparés — cohérent avec le fait qu'un
  template incomplet n'a pas de sens intermédiaire). Validation structurelle
  IMMÉDIATE (voir « Garde de non-dépassement » ci-dessous) — refusé sinon (400),
  aucune ligne créée.
- `POST /api/pricing/legal-payment-tier-templates/{id}/activate/` (`admin_keyimmo`
  uniquement) — active ce template : pose `activated_by`/`activated_at` (une fois,
  jamais réécrits ensuite) PUIS upsert concurrency-safe du pointeur
  `ActiveLegalPaymentTierTemplate` du `country_pack` (décision D-bis) — l'ancien
  template actif n'est JAMAIS modifié (`activated_by`/`activated_at` restent ce
  qu'ils étaient, preuve historique intacte), seul le pointeur change de cible.
- `GET /api/pricing/legal-payment-tier-templates/active/?country_pack_id=<id>`
  (`admin_keyimmo` uniquement) — lit `ActiveLegalPaymentTierTemplate` (paliers
  inclus), `null` si aucun pointeur pour ce `country_pack`.
- `GET /api/pricing/legal-payment-tier-templates/history/?country_pack_id=<id>`
  (`admin_keyimmo` uniquement) — historique de toutes les versions (brouillons et
  activées), ordonné.

## Garde de non-dépassement des plafonds cumulés — cœur de ce ticket

**Validation STATIQUE de la cohérence du template à la création, jamais un contrôle
de mouvement de fonds réel** (aucun n'existe dans ce projet) :

1. Les paliers, triés par `order`, ont des `cumulative_cap_percent` **strictement
   croissants** — deux paliers consécutifs au même plafond (ou décroissant) sont
   refusés.
2. Le DERNIER palier (par `order`) a un `cumulative_cap_percent` **exactement égal à
   100** — testé au cas limite exact : 100 accepté, 99,99 ou 100,01 refusés.
3. Refus = **aucune ligne créée**, ni `LegalPaymentTierTemplate` ni
   `LegalPaymentTierStep` (même discipline que `create_devis`/`LotAlreadyLockedError`,
   ticket 022 : rien n'est écrit avant l'exception).

## Explicitement hors scope

- **Tout mouvement de fonds, appel de fonds, notification bancaire** — aucun module
  de paiement n'existe dans ce projet à ce jour (`docs/gate3-classement-angles-morts.md`,
  item 1 : RESEARCH REQUIRED).
- **Tout lien FK avec `MilestoneTemplateStep`** (décision C) — `MilestoneTemplateStep.weight`
  reste non câblé, piste pour un futur ticket séparé.
- **Toute lecture candidate/constructeur** — réservé à `admin_keyimmo` uniquement,
  même principe que `PricingConfig` (ticket 025) : une structure de paiement légale
  n'a pas vocation à être exposée à un autre rôle dans ce ticket.
- **Toute UI.**

## Critères d'acceptation

- [x] `admin_keyimmo` peut créer un `LegalPaymentTierTemplate` brouillon avec ses
      paliers ; tout autre rôle → 403.
- [x] Paliers non strictement croissants → refusé (400), aucune ligne créée.
- [x] Dernier palier ≠ 100 exactement → refusé (400), aucune ligne créée — testé au
      cas limite exact (100 accepté ; 99,99 et 100,01 refusés).
- [x] Un template brouillon (jamais activé) n'apparaît JAMAIS via
      `GET .../active/`.
- [x] `admin_keyimmo` peut activer un template brouillon ; tout autre rôle → 403.
- [x] Activer un nouveau template rend l'ancien actif du même `country_pack`
      invisible via `GET .../active/` (le nouveau devient LE seul actif) — sans
      modifier l'ancien (`activated_by`/`activated_at` de l'ancien inchangés après
      coup, testé explicitement par relecture).
- [x] **Garantie DB, pas seulement applicative (décision D-bis)** : deux tentatives
      d'activation RÉELLEMENT concurrentes (deux vrais threads/connexions,
      `threading.Barrier`, `django_db(transaction=True)`) pour deux templates
      DIFFÉRENTS du même `country_pack` — une seule réussit à poser le pointeur, la
      seconde le rattrape explicitement (jamais une erreur remontée au client, jamais
      un doublon de pointeur), un seul `ActiveLegalPaymentTierTemplate` existe au
      final pour ce `country_pack`. Même schéma que
      `apps.tasks.tests.py::TestTaskCreationRaceUnderConcurrency` (ticket 017).
- [x] `GET .../history/` renvoie tous les templates (brouillons et activés) d'un
      `country_pack`, ordonnés.
- [x] `country_pack`/`version` reste unique ; `template`/`order` et `template`/`code`
      restent uniques par palier (mêmes contraintes que `MilestoneTemplate`/`Step`).
- [x] `allows_progressive_payments` est bien porté par PALIER, pas par template —
      testé avec un template mélangeant les deux valeurs entre ses paliers.
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits avant de
      considérer le ticket terminé.

## Notes d'implémentation

**Correction en cours de rédaction des tests (D-bis, deuxième passe)** — la première
version de `_upsert_active_pointer` utilisait
`ActiveLegalPaymentTierTemplate.objects.select_for_update().get_or_create(...)`. En
préparant le test de race (mêmes techniques de mock que
`TestTaskCreationRaceUnderConcurrency`, patch de `Manager.get`), il est apparu que
cette implémentation ne suivait pas la discipline anti-race déjà établie et EXPLICITE
du ticket 017 (`_get_or_create_task`) — qui évite précisément les raccourcis
`get_or_create()`/`update_or_create()` de Django au profit d'un `get()`/`create()`
manuel, plus facile à auditer et à tester par interception ciblée d'un seul point
d'entrée (`Manager.get`). Réécrite pour suivre exactement ce schéma avant d'écrire le
test définitif — voir `apps/pricing/services.py::_upsert_active_pointer`.

**RLS — décision de conception non anticipée dans le brief initial, tranchée pendant
l'implémentation** : contrairement à `PricingConfig` (ticket 025), qui est
VRAIMENT immuable et reçoit donc un verrou RLS complet (aucune policy
`UPDATE`/`DELETE`), `LegalPaymentTierTemplate` a un besoin de mutation LÉGITIME
(l'activation). Un verrou RLS `UPDATE` total casserait ce chemin ; une policy
`UPDATE` permissive n'offrirait aucune protection réelle. Décision : le verrou RLS
d'immutabilité (`SELECT`/`INSERT` permissifs, aucune policy `UPDATE`/`DELETE`,
`FORCE ROW LEVEL SECURITY`) est appliqué UNIQUEMENT à `LegalPaymentTierStep`
(migration `0004_legal_payment_tier_step_rls.py`), qui, lui, n'a effectivement
JAMAIS besoin d'être modifié — un changement de régime légal crée une nouvelle
version avec de nouveaux paliers. `LegalPaymentTierTemplate` et
`ActiveLegalPaymentTierTemplate` restent sans RLS (comme
`organizations_country_pack`/`organizations_role`, ticket 025) : garantie purement
applicative, aucune fonction `update`/`delete` n'existe côté service pour les champs
qui doivent rester figés.

**Suite de tests** : 33 tests dédiés dans `apps/pricing/tests.py` (création,
validation des plafonds au cas limite exact, unicité DB, activation/supersession,
lecture active/historique, permissions par rôle, immutabilité RLS des paliers, race
de concurrence réelle sur le pointeur). Suite complète du projet (256 tests) verte.
Test-garde exhaustif des routes (`apps/procurement/tests.py`,
`test_all_registered_get_api_routes_match_the_documented_list`) mis à jour
consciemment avec les 4 nouvelles routes.

**Deux flakiness préexistantes découvertes en lançant la suite complète, non liées à
ce ticket, signalées à l'utilisateur plutôt que corrigées dans ce scope** :
1. `apps/pricing/tests.py::TestPricingConfigCurrentAndHistory::
   test_current_returns_the_latest_rate_per_canal` (ticket 025) — `PricingConfig`
   dérive le taux actuel via `-created_at` seul (pas de colonne `sequence`), et peut
   échouer si deux créations rapprochées obtiennent le même horodatage (résolution
   d'horloge Windows) — même classe de piège que le tie-break déjà corrigé pour
   `TrustEvent` au ticket 013bis.
2. `apps/evidence/test_celery_integration.py`/`apps/tasks/test_celery_integration.py`
   (tests avec un VRAI worker Celery) — flaky quand plusieurs fixtures
   `real_celery_worker` de modules différents s'exécutent proches dans le temps
   (`DuplicateNodenameWarning`), passent de façon fiable en isolation. Aucun
   processus résiduel constaté après coup.

Ni l'un ni l'autre n'est causé par ce ticket (aucun code touché par B-027 n'est en
jeu) ; les deux méritent un ticket dédié si l'utilisateur souhaite les corriger.
