# Ticket B-032 — Garde `is_active` sur la création de taux/paliers légaux

## Statut

**Implémenté, testé (2 tests dédiés, suite complète 285 tests verte), documenté —
en attente du feu vert utilisateur pour fusion vers `master`.** Conception
tranchée avec l'utilisateur, même discipline que les tickets
012/024/025/026/B-027…B-031 : décisions actées avant d'écrire le code, pas
après.

## Origine

Ferme la dette signalée au ticket B-030 (« point de vigilance explicitement noté,
NON corrigé dans ce ticket ») : `apps.pricing.services.create_pricing_config`/
`create_legal_payment_tier_template` résolvent un `CountryPack` par `id`
uniquement, sans jamais vérifier son statut `is_active` — un `country_pack_id`
inactif deviné ou copié d'ailleurs contourne le filtre `is_active=True` appliqué
côté liste (`GET /api/organizations/country-packs/`, ticket B-030).

## Vérification préalable — aucun test existant ne dépend de ce comportement

Recherche exhaustive (`grep -n "CountryPack.objects.create"` sur tous les
fichiers de test du projet) avant implémentation : les deux seules créations de
`CountryPack` supplémentaires dans les tests concernés (Côte d'Ivoire,
`apps/pricing/tests.py`/`apps/procurement/tests.py`) n'indiquent pas `is_active`
explicitement — défaut `True` du modèle (`apps/organizations/models.py`). Aucun
test existant n'a besoin d'ajustement.

## Décisions de conception actées

**Exception dédiée, même famille que `LotAlreadyLockedError`/
`NoPricingConfigError`** : `CountryPackInactiveError` (`apps/pricing/services.py`),
une seule classe réutilisée par les deux fonctions de création — messages
spécifiques par appelant (comme `NoPricingConfigError`, qui inclut déjà le label
du pays concerné) :
- `create_pricing_config` : `f"Le Country Pack « {country_pack.label} » n'est
  pas actif — aucun taux ne peut y être créé."`
- `create_legal_payment_tier_template` : `f"Le Country Pack « {country_pack.label} »
  n'est pas actif — aucun palier légal ne peut y être créé."`

**409, pas 400** — même sémantique que `LotAlreadyLockedError`/
`NoPricingConfigError` : le corps de la requête est valide (un `country_pack_id`
qui existe réellement), c'est l'ÉTAT de ce `CountryPack` qui rend l'opération
impossible. Réponse `{'detail': str(exc)}`, ajoutée comme except clause dédiée
dans `PricingConfigCreateView.post`/`LegalPaymentTierTemplateCreateView.post`
(distincte du except `DjangoValidationError` existant, qui reste inchangé pour
« Country Pack introuvable »/les autres validations).

**Vérification posée juste après la résolution du `country_pack`**, avant toute
autre validation (steps vides, plafonds cumulés) — échec rapide, aucun effet de
bord, même discipline que `LotAlreadyLockedError`/`create_devis` (ticket 022) :
rien n'est écrit avant l'exception.

## Entités touchées

- `apps/pricing/services.py` — nouvelle exception `CountryPackInactiveError`,
  vérification ajoutée dans les deux fonctions de création.
- `apps/pricing/views.py` — nouvelle except clause (409) dans les deux vues de
  création.
- `apps/pricing/tests.py` — deux nouveaux tests dédiés.

## Scope inclus

- `CountryPackInactiveError` + vérification dans `create_pricing_config`.
- Même exception + vérification dans `create_legal_payment_tier_template`.
- 409 câblé dans les deux vues concernées.
- Un test par fonction, `CountryPack` inactif créé explicitement en fixture.

## Explicitement hors scope

- **Aucun changement à `GET /api/organizations/country-packs/`** (ticket B-030,
  déjà correct — filtre déjà appliqué côté liste).
- **Aucune vérification `is_active` ajoutée ailleurs** (ex. `activate_legal_
  payment_tier_template`, qui active un template déjà créé pour un
  `country_pack` — hors scope, ce ticket ferme uniquement la dette nommée par
  B-030 sur les DEUX fonctions de CRÉATION).
- **Aucune contrainte DB** (ex. `CHECK`) — vérification applicative seule, même
  niveau que le reste des gardes de ce module (`LotAlreadyLockedError`,
  validation des plafonds cumulés).

## Critères d'acceptation

- [x] `create_pricing_config` refuse la création pour un `CountryPack`
      `is_active=False`, lève `CountryPackInactiveError` avec le message exact
      ci-dessus, aucune ligne créée.
- [x] `create_legal_payment_tier_template` refuse la création pour un
      `CountryPack` `is_active=False`, lève `CountryPackInactiveError` avec le
      message exact ci-dessus, aucune ligne créée (ni le template, ni ses
      paliers).
- [x] `POST /api/pricing/configs/` et `POST /api/pricing/legal-payment-tier-templates/`
      renvoient 409 avec `{'detail': ...}` pour un `country_pack_id` inactif.
- [x] Un `CountryPack` actif continue de fonctionner normalement dans les deux
      cas (non-régression explicite — confirmé par la suite complète).
- [x] Aucun test existant ne casse (vérifié avant implémentation : aucun ne
      dépendait de ce comportement ; confirmé après implémentation, suite
      complète verte).
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits avant
      de considérer le ticket terminé.

## Notes d'implémentation

Implémentation directe, conforme à la proposition validée — aucune surprise ni
écart rencontré en écrivant le code ou les tests (contrairement à la plupart
des tickets précédents de cette série). La vérification préalable (recherche
exhaustive des créations de `CountryPack` dans les tests) s'est confirmée
exacte : aucun ajustement de fixture n'a été nécessaire.

**Suite de tests** : 2 tests dédiés (un par fonction de création), chacun avec
un `CountryPack` inactif créé explicitement en fixture, vérifiant le code 409,
le message exact (présence du label dans `detail`), et l'absence de toute
ligne créée. Suite `pricing` complète : 38 tests. Suite complète du projet :
285 tests, tous verts.
