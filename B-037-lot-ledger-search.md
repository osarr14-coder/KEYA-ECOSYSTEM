# Ticket B-037 — Recherche des lots éligibles à la création d'un LotLedger

## Statut

**Implémenté, testé, documenté.** 6 tests dédiés
(`apps/procurement/tests.py`), suite `procurement` 91 tests (+6), suite
complète du projet 362 tests, tous verts.

## Origine

Anticipé pour **F-035** (écran frontend du grand-livre, en cours de
cadrage côté utilisateur) — même besoin déjà rencontré à chaque nouvel
écran admin qui doit résoudre un lot par nom avant d'agir dessus (B-028
pour la création de `Devis`). `admin_keyimmo` a besoin de chercher, par
nom, les lots pour lesquels un `LotLedger` (B-035) peut légitimement être
créé — même logique de recherche cross-organisation que B-028
(`admin_keyimmo` n'est structurellement membre d'AUCUNE des organisations
qu'il gère).

## Vérification préalable — mécanisme réutilisable

**`apps.procurement.services.search_lots_as_admin` (ticket B-028) fait
DÉJÀ tout le travail coûteux** — énumérer les organisations existantes,
basculer le contexte RLS UNE PAR UNE, chercher les lots par nom, cumuler
les résultats jusqu'à `MAX_SEARCH_RESULTS`, restaurer le contexte de
l'appelant. **Seul le CRITÈRE D'INCLUSION par lot diffère** entre B-028
(exclut les lots déjà verrouillés — mise en concurrence encore ouverte) et
ce ticket (l'INVERSE : lot déjà verrouillé, ET sans `LotLedger` existant).

**Décision proposée (A)** : extraire le corps de la boucle dans une
fonction privée `_search_lots_by_name_as_admin(*, admin_organization_id,
query, include_lot)`, où `include_lot(lot)` est un prédicat appelé SOUS LA
MÊME bascule RLS déjà positionnée pour ce lot (même précondition que
`is_lot_locked` aujourd'hui). `search_lots_as_admin` devient un mince
wrapper qui lui passe `include_lot=lambda lot: not is_lot_locked(lot.id)`
— signature ET comportement PUBLICS inchangés, zéro risque de régression
sur B-028 (prouvé par la suite de tests existante, relancée sans
modification). Une nouvelle fonction publique,
`search_lots_eligible_for_ledger_as_admin`, réutilise le MÊME helper privé
avec `include_lot=lambda lot: is_lot_locked(lot.id) and not
LotLedger.objects.filter(lot=lot).exists()`.

**Pourquoi un endpoint séparé malgré la réutilisation** : les deux critères
sont mutuellement exclusifs par construction (un lot ne peut pas être « pas
encore verrouillé » ET « déjà verrouillé »), jamais un simple paramètre de
requête optionnel sur l'endpoint existant — deux besoins UI distincts
(choisir un lot pour une candidature vs. choisir un lot pour un
grand-livre), deux routes, même mécanisme interne.

## Décisions de conception proposées

**B. Réponse — `LotSearchResultSerializer` (B-028) réutilisé TEL QUEL**,
aucun nouveau serializer : la forme demandée (`{id, name, organization:
{id, name}, program: {id, name}}`) est EXACTEMENT celle déjà produite par
ce serializer pour B-028.

**C. Route** : `GET /api/procurement/admin/lots/eligible-for-ledger/?q=`,
nom `procurement-admin-lot-eligible-for-ledger-search`, réservé
`admin_keyimmo` (`IsAdminKeyimmo`, même permission que tous les autres
endpoints de ce module). Placée dans `apps/procurement/urls.py` à côté de
`procurement-admin-lot-search` — structurellement distincte de
`.../lots/<uuid:lot_id>/devis/` (segment `<uuid:...>` vs littéral
`eligible-for-ledger`), aucune collision possible dans le résolveur
Django.

**D. `query` vide → liste vide**, même convention que
`search_organizations_as_admin`/`search_lots_as_admin` — jamais un dump
complet.

**E. `MAX_SEARCH_RESULTS` réutilisée telle quelle** (même constante,
même limite MVP assumée — borne les RÉSULTATS, pas le nombre de requêtes,
voir la docstring existante de `search_lots_as_admin`).

## Entités touchées

**`apps/procurement/services.py`** :
- `_search_lots_by_name_as_admin(*, admin_organization_id, query,
  include_lot)` — NOUVELLE fonction privée, extraite du corps actuel de
  `search_lots_as_admin`.
- `search_lots_as_admin(*, admin, admin_organization_id, query)` —
  RÉÉCRITE comme un mince wrapper autour de la fonction ci-dessus, même
  signature publique, même comportement (non-régression).
- `search_lots_eligible_for_ledger_as_admin(*, admin, admin_organization_id,
  query)` — NOUVELLE fonction publique, même wrapper avec un `include_lot`
  différent.

**`apps/procurement/views.py`** :
- `AdminLotEligibleForLedgerSearchView` — NOUVELLE vue, même forme que
  `AdminLotSearchView`.

**`apps/procurement/urls.py`** : une nouvelle route (voir décision C).

**`apps/procurement/serializers.py`** : AUCUN changement
(`LotSearchResultSerializer` réutilisé tel quel).

## Scope inclus

- Refactor de `search_lots_as_admin` en wrapper (comportement/signature
  publics inchangés).
- `search_lots_eligible_for_ledger_as_admin` + vue + route.
- Mise à jour du test-garde exhaustif des routes
  (`apps/procurement/tests.py`).

## Explicitement hors scope

- **Tout écran frontend** — F-035 reste un chantier séparé, en cours de
  cadrage, pas encore prêt à consommer cet endpoint.
- **Toute modification de `create_lot_ledger`/`LotLedgerCreateView`**
  (B-035) — cette recherche prépare l'appel, ne le remplace pas ; la
  précondition de verrouillage y reste vérifiée indépendamment (même
  principe que B-028 : la recherche aide à choisir un lot, elle ne
  garantit rien qui ne soit pas revérifié par l'endpoint de création
  lui-même).
- **Toute modification de `search_organizations_as_admin`** (B-028,
  résolution d'organisation candidate) — sans rapport avec ce ticket.

## Critères d'acceptation

- [x] Un lot dont le devis n'est PAS verrouillé → exclu des résultats.
      (`test_a_lot_without_a_locked_devis_is_excluded`)
- [x] Un lot dont le devis est verrouillé mais SANS `LotLedger` existant →
      INCLUS.
      (`test_admin_keyimmo_can_find_an_eligible_lot_in_an_organization_he_is_not_a_member_of`)
- [x] Un lot dont le devis est verrouillé ET qui a DÉJÀ un `LotLedger` →
      exclu.
      (`test_a_lot_that_already_has_a_ledger_is_excluded`)
- [x] `query` vide → liste vide.
      (`test_empty_query_returns_an_empty_list_never_a_dump`)
- [x] Recherche cross-organisation confirmée (comme B-028) — un lot d'une
      organisation dont `admin_keyimmo` n'est membre d'AUCUNE apparaît
      quand même dans les résultats.
      (prouvé par le même test que le critère « INCLUS » ci-dessus —
      `assert sponsor_org.id != admin_org.id`)
- [x] `MAX_SEARCH_RESULTS` toujours respectée (résultats plafonnés).
      (`test_more_than_max_search_results_matches_are_capped`)
- [x] Rôle non-admin → 403.
      (`test_a_constructeur_cannot_search`)
- [x] **Non-régression explicite** : la suite de tests EXISTANTE de
      `search_lots_as_admin`/`AdminLotSearchView` (B-028) passe SANS
      AUCUNE modification après le refactor — preuve que le comportement
      public n'a pas changé.
      (`TestAdminLotSearch`, 7 tests, fichier NON modifié par ce ticket —
      seule la classe `TestAdminLotEligibleForLedgerSearch` a été
      ajoutée)
- [x] Route ajoutée au test-garde exhaustif des routes du projet.
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits
      avant de considérer le ticket terminé.

## Notes d'implémentation

**Refactor sans surface de risque** : `_search_lots_by_name_as_admin`
extrait le corps EXACT de l'ancienne `search_lots_as_admin` (même ordre
d'opérations, même gestion du `finally`, même variable `results`) —
`search_lots_as_admin` devient un appel one-liner au helper avec
`include_lot=lambda lot: not is_lot_locked(lot.id)`. Aucune ligne de la
suite `TestAdminLotSearch` (B-028, 7 tests) n'a été touchée ; elle est
passée verte sans modification lors du premier lancement du module
`procurement`, preuve directe (pas seulement présumée) de la
non-régression exigée par ce ticket — y compris les deux tests les plus
sensibles au refactor : `test_a_search_matching_nothing_still_iterates_
every_organization_worst_case` (espionne `set_rls_context` via
`mock.patch`) et `test_rls_context_is_restored_even_when_an_exception_
interrupts_the_loop` (patche `is_lot_locked` avec un `side_effect`) — les
deux continuent de fonctionner parce que le `lambda` du wrapper résout
`is_lot_locked`/`set_rls_context` par leur nom de module à l'appel,
exactement comme le faisait le corps de fonction original.

**`candidate_organization` créée directement par l'ORM dans le test de
plafond** (`test_more_than_max_search_results_matches_are_capped`) —
`create_devis`/`lock_devis` n'exigent qu'un `Organization` existant pour
`candidate_organization_id`, jamais un compte utilisateur réel : réutilise
la même optimisation de performance déjà documentée pour
`_create_sponsor_org_with_lot` (ticket B-028), évite 55 hachages de mot
de passe inutiles pour un test qui ne vérifie que le comptage.

**Aucune anomalie trouvée en écrivant les tests.**

6 tests dédiés, suite `procurement` 91 tests, suite complète du projet
362 tests, tous verts.
