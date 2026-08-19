# Ticket B-028 — Recherche de Lot/Organisation pour `admin_keyimmo`

## Statut

**Implémenté, testé (12 tests dédiés, suite complète 270 tests verte), documenté —
en attente du feu vert utilisateur pour fusion vers `master`.** Conception tranchée
avec l'utilisateur (points A/B/C/D), même discipline que les tickets
012/024/025/026/B-027 : décisions actées avant d'écrire le code, pas après.

## Origine

Découvert par la session frontend en préparant le ticket F-027 (écrans Devis/Appels
d'offres réels) : `POST /api/procurement/devis/` exige `organization` (celle du lot)
et `candidate_organization`, mais aucun endpoint ne permet à `admin_keyimmo` de
découvrir un `Lot` ou une `Organization` en dehors de ses propres memberships —
`GET /api/programs/lots/`/`GET /api/build/lots/` sont strictement scopés à
`request.organization`, et `apps/organizations/urls.py` n'expose aucune liste
d'organisations. `DevisView` (F-027) fonctionne actuellement en saisie manuelle
d'UUID, avec bannière explicite — dépendance bloquante documentée côté frontend,
transmise à cette session. Vérifié avant rédaction : aucun endpoint similaire
n'existe déjà ailleurs dans le projet (`procurement/admin/lots/<uuid:lot_id>/devis/`,
ticket 022, est un endpoint DIFFÉRENT — liste les devis d'un lot déjà CONNU, pas une
recherche).

## Obstacle technique central — pourquoi ce n'est pas un simple endpoint de plus

Vérifié directement en base (`pg_class.relrowsecurity`/`relforcerowsecurity`) avant
de concevoir la solution :

- **`organizations_organization`** : aucune RLS (confirmé vivant en base, cohérent
  avec ce que le ticket 025 avait déjà noté pour `CLAUDE.md`). Recherche
  d'organisation triviale, même schéma que `apps.backoffice.services.search_users`
  (ticket 011).
- **`programs_lot`** : RLS activée ET forcée (`ENABLE`/`FORCE ROW LEVEL SECURITY`),
  policy stricte `organization_id = current_org`, `FOR ALL` (migration
  `0002_programs_rls.py`, ticket 002). Un `admin_keyimmo` qui n'est membre d'AUCUNE
  organisation candidate ne peut structurellement pas lire leurs lots par une
  requête RLS normale.

**Différence avec tous les cas de bascule RLS précédents de ce projet** (`create_
inspection`/`create_mission`/`create_devis`/`lock_devis`/`get_user_memberships`) :
dans tous ces cas, l'organisation CIBLE est déjà CONNUE avant l'appel (fournie
explicitement par l'appelant). Ici, c'est justement ce qu'on cherche — la bascule
« vers une cible déjà connue » ne s'applique pas telle quelle.

**Alternative écartée** : une policy RLS supplémentaire sur `programs_lot`
autorisant la lecture quand le rôle de l'utilisateur courant est `admin_keyimmo`
recréerait la récursion déjà rencontrée et abandonnée au ticket 011
(`get_user_memberships`) — une policy qui doit lire `organizations_membership`/
`organizations_role` (elles-mêmes sous `FORCE ROW LEVEL SECURITY`) pour se évaluer
elle-même provoque une erreur Postgres de récursion, et la parade usuelle
(fonction `SECURITY DEFINER` + `row_security = off`) échoue pour la même raison
sous `FORCE ROW LEVEL SECURITY`. Voir `apps/backoffice/services.py::
get_user_memberships` pour le raisonnement complet déjà documenté.

**Solution retenue (point A)** : énumérer les organisations existantes (table libre
de RLS, lecture immédiate), puis basculer le contexte RLS **une organisation à la
fois** pour y chercher les lots correspondants, en cumulant les résultats — un
`set_rls_context` par organisation testée, jamais un bypass RLS global, jamais une
nouvelle policy. Extension directe, en boucle, du même mécanisme de bascule déjà
établi (tickets 005/011/012/022), pas un nouveau mécanisme.

## Décisions de conception actées

**A. Coût de la recherche de lots — limite MVP assumée et documentée
explicitement.** `MAX_SEARCH_RESULTS` (= 50, même valeur que
`apps.backoffice.services.search_users`) borne le nombre de **résultats retournés**,
PAS le nombre de requêtes exécutées : une recherche qui ne trouve rien ou peu de
correspondances continue d'itérer TOUTES les organisations existantes avant de
répondre — le pire cas reste **O(nombre d'organisations)** requêtes SQL par
recherche. Acceptable au stade actuel du projet (peu d'organisations réelles) ;
deviendrait un vrai problème de performance à plus grande échelle — aucune
optimisation (cache, index texte, dénormalisation) n'est construite dans ce ticket.
Documenté explicitement dans le code (docstring du service), pas seulement ici.

**B. Champ de recherche des lots : `Lot.name` seul.** Pas de recherche élargie à
`Asset.name`/`Program.name` dans ce ticket — plus simple, cohérent avec
`search_users` (un seul champ), extensible plus tard si un besoin réel de
distinguer des lots au nom identique dans des programmes différents se confirme.

**C. Forme de la réponse d'un lot trouvé : `id`, `name`, `organization {id, name}`,
`program {id, name}`.** Le `program` est inclus (bien que la recherche elle-même ne
porte que sur `Lot.name`, point B) pour que l'admin confirme visuellement le bon
programme parent avant de sélectionner un lot — nécessaire dès qu'un nom de lot
générique (« Lot A ») se répète entre programmes. `asset` n'est PAS inclus dans la
réponse — pas demandé, pas nécessaire pour soumettre `POST /api/procurement/devis/`
(qui n'attend que `organization`+`lot`). Aucun montant, aucune donnée sensible —
`Lot` n'en expose de toute façon nulle part dans ce projet.

**D. Exclusion des lots déjà verrouillés.** La recherche ne retourne QUE des lots
pour lesquels `apps.procurement.services.is_lot_locked(lot_id)` est faux — un lot
dont la mise en concurrence est déjà close (un devis verrouillé existe) n'a plus de
raison d'apparaître dans une recherche destinée à enregistrer un NOUVEAU devis.
`is_lot_locked` est appelée DANS la même bascule RLS que la lecture du lot
(déjà positionnée sur l'organisation de ce lot au moment de l'appel — même
précondition que documentée dans `is_lot_locked` lui-même, aucune bascule
supplémentaire nécessaire). Couplage volontaire de ce ticket à `apps.procurement`
(import direct, pas de duplication de logique) — cohérent avec le fait que ces deux
endpoints n'ont de sens que comme préparation à `POST /api/procurement/devis/`.

## Entités touchées

Aucune nouvelle table, aucune migration — uniquement des fonctions de service et
deux endpoints, dans `apps/procurement` (module déjà propriétaire de
`POST /api/procurement/devis/`, ce ticket lui appartient naturellement plutôt qu'à
`apps/organizations`/`apps/programs`, qui n'ont aucun autre endpoint réservé à
`admin_keyimmo`).

## Scope inclus

- `GET /api/procurement/admin/lots/?q=<recherche>` (`admin_keyimmo` uniquement) —
  recherche de lot par nom (point B), toutes organisations confondues, EXCLUT les
  lots déjà verrouillés (point D). `q` absent ou vide : liste vide, jamais un dump.
  Réponse : liste de `{id, name, organization: {id, name}, program: {id, name}}`
  (point C), plafonnée à `MAX_SEARCH_RESULTS`.
- `GET /api/procurement/admin/organizations/?q=<recherche>` (`admin_keyimmo`
  uniquement) — recherche d'organisation par nom, aucune bascule RLS nécessaire
  (`organizations_organization` n'a pas de RLS). Réponse : liste de `{id, name}`,
  plafonnée à `MAX_SEARCH_RESULTS`. Utilisable pour résoudre `candidate_organization`
  ET, en théorie, `organization`/le lot lui-même n'a pas besoin de cet endpoint
  puisque la recherche de lot retourne déjà son organisation (point C) — cet
  endpoint sert spécifiquement à résoudre le candidat, jamais réutilisé pour
  résoudre l'organisation du lot.
- `apps.procurement.services.search_lots_as_admin(*, admin, admin_organization_id,
  query)` et `search_organizations_as_admin(query)`.

## Explicitement hors scope

- **Toute optimisation de performance** (cache, index texte PostgreSQL type
  `pg_trgm`, dénormalisation d'un `organization_name` sur `Lot`) — limite MVP
  assumée (point A), à traiter dans un futur ticket si le nombre d'organisations
  réelles le justifie.
- **Recherche élargie à `Asset`/`Program`** (point B) — piste pour un futur ticket
  si un besoin réel se confirme.
- **Toute écriture** — ces deux endpoints sont strictement `GET`, aucune mutation.
- **Toute lecture candidate/constructeur** — réservé à `admin_keyimmo` uniquement,
  même principe que tous les endpoints `apps.procurement`/`apps.pricing` déjà
  réservés à ce rôle.
- **Toute UI** — le frontend (session F-027/F-028) consomme ces endpoints
  séparément.

## Critères d'acceptation

- [x] `admin_keyimmo` peut rechercher des lots par nom, toutes organisations
      confondues (y compris des organisations dont il n'est membre d'AUCUNE) ;
      tout autre rôle → 403.
- [x] `q` absent ou vide → liste vide, jamais un dump de tous les lots.
- [x] Un lot dont le nom ne correspond pas à `q` n'apparaît jamais dans les
      résultats (`icontains`, insensible à la casse).
- [x] Un lot déjà verrouillé (devis verrouillé existant, ticket 022) n'apparaît
      JAMAIS dans les résultats, même si son nom correspond à `q` — testé
      explicitement (lot verrouillé absent, lot non verrouillé du même nom présent,
      dans deux organisations DIFFÉRENTES, prouvant que l'exclusion s'applique lot
      par lot à travers la boucle, pas organisation par organisation).
- [x] La réponse d'un lot trouvé contient `organization {id, name}` et
      `program {id, name}` corrects (pas de fuite d'un autre lot/organisation).
- [x] Plus de `MAX_SEARCH_RESULTS` correspondances existantes → réponse plafonnée à
      `MAX_SEARCH_RESULTS`, jamais une erreur.
- [x] `admin_keyimmo` peut rechercher des organisations par nom ; tout autre rôle →
      403 ; `q` absent ou vide → liste vide.
- [x] Aucune fuite de données sensibles (montant, marge) sur les deux endpoints —
      `Lot`/`Organization` n'en exposent de toute façon aucune.
- [x] Le contexte RLS de l'appelant (`admin_keyimmo`, sa propre organisation) est
      restauré après la recherche de lots, même en cas d'exception pendant la
      boucle — testé explicitement (une lecture RLS-scopée normale, juste après un
      appel à `search_lots_as_admin`, doit refonctionner sans bascule manuelle).
- [x] **Pire cas documenté au point A prouvé par un test dédié** : une recherche
      sans aucune correspondance bascule le contexte RLS vers CHAQUE organisation
      existante avant de répondre (`threading` non nécessaire ici, contrairement au
      ticket B-027 — pas de concurrence en jeu, juste un test d'espionnage d'appels
      via `mock.patch(..., wraps=...)`).
- [x] Test-garde exhaustif des routes (`apps/procurement/tests.py::
      test_all_registered_get_api_routes_match_the_documented_list`) mis à jour
      consciemment avec les 2 nouvelles routes.
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits avant de
      considérer le ticket terminé.

## Notes d'implémentation

**`is_lot_locked` réutilisé tel quel, sans modification** — sa précondition
documentée (« déjà basculé sur l'organisation du lot au moment de l'appel ») était
déjà exactement ce dont `search_lots_as_admin` a besoin à l'intérieur de sa propre
boucle de bascule : aucune bascule RLS supplémentaire, aucun paramètre ajouté,
seule sa docstring a été mise à jour pour mentionner ce nouvel appelant.

**Réponse du lot — piège UUID rencontré en écrivant le premier test** :
`LotSearchResultSerializer.get_organization`/`get_program` (des
`SerializerMethodField`, pas des champs DRF typés) retournaient initialement un
dict Python construit à la main avec `lot.organization_id` brut (un objet
`uuid.UUID`, pas une chaîne) — `response.data` (utilisé directement par les tests,
AVANT le rendu JSON final) exposait donc un `UUID` là où le test comparait une
chaîne. Un champ DRF typé (`serializers.UUIDField()`) convertit automatiquement en
chaîne dès `to_representation`, mais un dict construit à la main dans une méthode
`SerializerMethodField` ne passe par AUCUNE conversion de champ — corrigé par un
`str(...)` explicite sur les deux identifiants.

**Erreur d'édition trouvée et corrigée avant de lancer la suite** : l'insertion des
nouvelles classes de tests dans `apps/procurement/tests.py` a d'abord coupé en deux
le dernier test préexistant du fichier
(`test_a_later_pricing_config_change_never_affects_an_already_created_devis`,
ticket 026) — sa seconde assertion (`assert devis.marge_estimee ==
_expected_marge(AMOUNT_A)`) s'est retrouvée orpheline, physiquement déplacée à la
toute fin du fichier, dans le corps d'un test B-028 sans aucun rapport
(`NameError: name 'devis' is not defined` à la première exécution). Détecté
immédiatement par l'échec du test, jamais par relecture silencieuse — corrigé en
restaurant l'assertion dans son test d'origine et en supprimant la ligne orpheline.
Aucune perte de couverture : le test du ticket 026 a retrouvé ses deux assertions
originales.

**Test du pire cas (point A) — technique d'espionnage, pas de comptage de
requêtes SQL** : `mock.patch('apps.procurement.services.set_rls_context',
wraps=services.set_rls_context)` laisse la fonction réelle s'exécuter
normalement tout en enregistrant chaque appel — le test vérifie que TOUS les
`organization_id` de trois organisations créées pour l'occasion ont bien été
utilisés comme cible d'une bascule, pour une recherche qui ne trouve rien. Plus
direct et plus lisible qu'un comptage de requêtes SQL (`django.test.utils.
CaptureQueriesContext`), et vérifie précisément le comportement documenté (bascule
par organisation), pas un effet de bord indirect (nombre de requêtes, qui varierait
avec des détails d'implémentation non pertinents comme `select_related`).

**Helper `_create_sponsor_org_with_lot` — délibérément SANS passer par l'API de
registration**, contrairement à `_setup_lot_up_for_bid`/`_register` : nécessaire
pour que `test_more_than_max_search_results_matches_are_capped` (55 organisations)
reste rapide (pas de hachage de mot de passe répété) — aucun utilisateur n'est
nécessaire pour ces organisations, seule leur existence et leurs lots comptent pour
la recherche.

**Suite de tests** : 12 tests dédiés (4 `TestAdminOrganizationSearch`, 8
`TestAdminLotSearch`, dont les deux explicitement requis par l'utilisateur —
exclusion cross-organisation et pire cas O(n)). Suite `procurement` complète : 49
tests. Suite complète du projet : 270 tests, tous verts.
