# B-041 — Circuit formel de résolution de litiges (support client)

## Contexte

Gate 3, item 4 (`docs/gate3-classement-angles-morts.md`) : SHOULD.
Justification reprise : le ticket 011 (messagerie tracée) a été motivé par
la préservation de la chaîne de preuve (éviter les échanges hors
plateforme) — une fois des litiges réels attendus avec de vrais
utilisateurs, l'absence de circuit de résolution formel devient visible
rapidement.

## Décisions validées (avant code, avec Assane Sarr)

1. **Qui ouvre un litige** : le **client**, depuis HOME. Première écriture
   jamais exposée par cette app (jusqu'ici strictement lecture seule,
   ticket 008/`008-home-client-lecture-seule.md`) — brèche délibérée et
   étroite, pas une remise en cause générale de l'invariant : HOME reste
   sans modèle propre (`Litige` vit dans une nouvelle app `apps/support`),
   et cette seule action d'écriture est strictement scopée à « ouvrir un
   litige sur MON lot » (vérifié via `LotClient`, même garde que
   `_ClientLotScopedView`).
2. **Qui résout** : `admin_keyimmo` uniquement — même rôle gatekeeper que
   B-039, cohérent avec l'objectif du ticket 011 (« donner à l'équipe
   KEYIMMO un minimum de visibilité/action »).
3. **Découverte transverse par l'admin** : nouveau mécanisme RLS — une
   policy `support_litige` avec une branche `admin_keyimmo` en plus du
   scoping standard par organisation active. Vérifié non-récursif : la
   branche interroge `organizations_membership` (table différente,
   filtrée sur `user_id = current_user`, donc déjà couverte par SA PROPRE
   policy existante sans contournement) — pas la récursion qui avait fait
   échouer une tentative similaire directement SUR `organizations_membership`
   elle-même (ticket 011, voir `apps/backoffice/services.py::
   get_user_memberships`). Premier précédent de ce type dans le projet,
   réutilisable pour de futurs tableaux de bord admin transverses.

## Piège RLS réel rencontré en écrivant `LitigeListView`

`Litige.objects.select_related('lot', ...)` revenait **vide** pour un
litige pourtant visible sous la nouvelle policy `support_litige_select` —
la policy `support_litige` elle-même fonctionnait (prouvé en isolant la
requête sans jointure). La jointure vers `programs_lot` était
silencieusement éliminée par **sa propre** policy RLS
(`programs_lot_scope`, ticket 002 — organisation active seule, aucune
branche `admin_keyimmo`) : piège RLS classique — un `INNER JOIN` vers une
table dont la policy exclut la ligne fait disparaître la ligne du résultat
sans aucune erreur.

**Premier correctif tenté, abandonné avant commit** : une policy
`admin_keyimmo` transverse SANS condition sur `support_litige` —
accordait à tort une visibilité GLOBALE de tout `Lot` à `admin_keyimmo`,
y compris sans aucun litige. Détecté par la suite complète existante :
`apps.procurement.tests.TestAdminLotSearch::
test_rls_context_is_restored_even_when_an_exception_interrupts_the_loop`
suppose explicitement (B-037/B-039) qu'un admin sans bascule RLS
explicite ne voit PAS le lot d'une autre organisation — la version large
cassait cette garantie PARTOUT dans le projet, pas seulement pour
`Litige`.

**Correctif retenu** : la policy (`apps/programs/migrations/
0009_lot_admin_keyimmo_select.py`) ne s'applique qu'aux lots ayant AU
MOINS un `Litige` (`EXISTS (SELECT 1 FROM support_litige WHERE
support_litige.lot_id = programs_lot.id)`) — exactement le besoin réel
(afficher le lot d'un litige déjà visible), rien de plus large. Une
SECONDE policy PERMISSIVE, SELECT uniquement, à côté de
`programs_lot_scope` (Postgres combine plusieurs policies PERMISSIVE par
OR) — strictement additif : aucun risque sur les policies INSERT/UPDATE/
DELETE existantes (gatekeeper B-039 intact), ni sur une recherche de lot
admin ordinaire. Régression couverte par un test dédié
(`apps/backoffice/tests.py::TestLitigeAdminTransverseVisibility::
test_admin_does_not_gain_blanket_visibility_of_a_lot_without_any_litige`).

## Scope

- Nouvelle app `apps/support` :
  - `Litige` (`organization`, `lot`, `opened_by`, `description`, `status`,
    `resolution_note`, `resolved_by`, `resolved_at`, `created_at`).
    `status` **stocké** (`ouvert`/`resolu`/`rejete`) — exception documentée
    à la doctrine « jamais de statut stocké », même justification que
    `Task` (ticket 006) : un litige n'affirme aucune confiance sur le lot,
    son statut est un fait sur LUI-MÊME (traité ou non), pas sur le sujet
    référencé.
  - Migration RLS : policy standard (organisation active) + branche
    `admin_keyimmo` transverse pour `SELECT`/`UPDATE` (jamais `INSERT` —
    l'admin ne crée jamais de litige, seul le client le fait, dans son
    organisation active).
  - `services.py` : `open_litige`, `resolve_litige`, `list_open_litiges`
    (transverse, pour l'admin).
- `apps/home` : `LotLitigesView` (`GET`/`POST
  /api/me/lots/{lot_id}/litiges/`), même garde `_ClientLotScopedView` que
  `LotOverviewView`/`LotEvidenceFeedView` — un lot non assigné au client
  renvoie 404, jamais 403.
- `apps/backoffice` : `LitigeListView` (`GET /api/backoffice/litiges/`,
  filtrable `?status=`) + `LitigeResolveView` (`POST
  /api/backoffice/litiges/{id}/resolve/`, `{status, resolution_note}`) —
  réservés `IsAdminKeyimmo`. Met à jour le test de garde
  `test_backoffice_urls_expose_exactly_the_documented_actions` (2 routes de
  plus, consciemment).

## Hors scope (assumé, pas oublié)

- **Fil de messages sur un litige** — `Litige` n'est PAS ajouté à
  `ALLOWED_SUBJECT_MODELS` (messaging, ticket 011) dans cette passe : la
  description initiale du client suffit au MVP ; un vrai back-and-forth
  tracé serait la suite naturelle une fois ce circuit de base validé en
  usage réel, ticket séparé.
- **Notification Task Inbox** (ticket 006) à l'ouverture — pas de bénéficiaire
  unique évident (`admin_keyimmo` n'est pas UN utilisateur mais un rôle
  potentiellement porté par plusieurs), et la nouvelle liste transverse
  (`GET /api/backoffice/litiges/?status=ouvert`) sert déjà la découverte.
  Une notification proactive resterait un ticket séparé si le besoin se
  confirme.
- **Tout écran frontend** — HOME (bouton "signaler un problème") et
  back-office (liste + résolution) : tickets frontend séparés, même
  pattern que B-039/B-040.
- **Réouverture d'un litige résolu/rejeté** — statut terminal, pas de
  transition retour dans cette passe.

## Critères d'acceptation

- Un client peut ouvrir un litige sur un lot qui lui est assigné
  (`LotClient`) — `status` initial `ouvert`.
- Un client ne peut PAS ouvrir de litige sur un lot qui existe mais ne lui
  est pas assigné (même dans son organisation) — 404, jamais 403.
- Un utilisateur non `admin_keyimmo` ne peut ni lister ni résoudre aucun
  litige via les routes back-office — 403.
- `admin_keyimmo` voit TOUS les litiges ouverts, y compris dans une
  organisation dont il n'est membre d'aucune ligne `Membership` — preuve du
  critère central de ce ticket (nouvelle policy RLS transverse).
- Résoudre un litige exige une `resolution_note` non vide — jamais de
  clôture silencieuse sans justification.
- Résoudre/rejeter un litige n'écrit AUCUN `TrustEvent` — un litige n'est
  pas un objet Visible Trust (même test de garde que
  `test_backoffice_module_never_imports_or_references_the_trust_module`).
- Suite `apps/support/tests.py` (nouvelle) + `apps/home/tests.py` +
  `apps/backoffice/tests.py` vertes, sans régression.
