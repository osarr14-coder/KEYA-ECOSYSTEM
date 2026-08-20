# Ticket F-029 — Noms lisibles dans la liste des devis (DevisView)

## Statut
Livré. Branche `feature/frontend-round-2`. Consomme les champs additifs
`lot_detail`/`candidate_organization_detail` ajoutés à `DevisAdminSerializer`
au ticket B-029 (backend, fusionné) pour remplacer l'affichage en UUID brut
de l'organisation candidate dans `DevisView`, et enrichir chaque ligne avec
le nom du lot et de son programme parent.

## Vérification du contrat API — avant tout code, comme d'habitude
Lecture directe de `backend/apps/procurement/{serializers,services}.py`
après fusion de B-029 dans `origin/master` :

- `DevisAdminSerializer` expose désormais, EN PLUS des champs existants
  (`id, organization, candidate_organization, lot, amount, marge_estimee,
  logged_by, created_at, status`) — jamais à leur place (décision A du
  ticket B-029, vérifié : aucun champ retiré, `apps/web/src/api/types.ts`
  et les corps de requête `DevisLockView`/`DevisAjustementView`, qui
  attendent `organization` en UUID brut, restent valides tels quels) :
  - `lot_detail` — RÉUTILISE littéralement `LotSearchResultSerializer`
    (ticket B-028) : `{id, name, organization: {id, name}, program: {id,
    name}}`.
  - `candidate_organization_detail` — RÉUTILISE littéralement
    `OrganizationSearchResultSerializer` (ticket B-028) : `{id, name}`.
- **Pas de `organization_detail` séparé** (décision C du ticket B-029) :
  `Devis.organization` vaut toujours l'organisation du lot par construction,
  donc identique à `lot_detail['organization']` — rien à ajouter.
- **`logged_by` reste un UUID brut**, sans équivalent `_detail` — le
  backend ne l'a pas résolu, donc le frontend ne peut pas le faire non
  plus sans inventer une donnée. Hors scope de B-029 et de ce ticket.

## Ce qui a été construit
- `apps/web/src/api/types.ts` : `Devis` gagne `lot_detail: LotSearchResult`
  et `candidate_organization_detail: OrganizationSearchResult` — réutilise
  LITTÉRALEMENT les types déjà définis pour la recherche B-028 (ticket
  F-027), jamais une forme dupliquée, cohérent avec la réutilisation faite
  côté backend.
- `apps/web/src/views/DevisView.tsx::DevisRow` :
  - Nouvelle colonne « Lot » : `${lot_detail.name} — ${lot_detail.program.name}`.
  - Colonne « Organisation candidate » : `candidate_organization_detail.name`
    au lieu de l'UUID brut `candidate_organization`.
  - **Les UUID restent accessibles, jamais simplement masqués** (demande
    explicite du ticket) : chaque cellule concernée porte `title={uuid}`
    (infobulle navigateur, survol) ET un attribut technique dédié
    (`data-lot-id`/`data-organization-id`) — un consommateur externe (test,
    extension navigateur, futur export) peut donc lire l'UUID réel sans
    dépendre du rendu d'une infobulle.
  - `logged_by`/`amount`/`created_at`/`status` inchangés.

## Vérification
- **4 nouveaux tests** (`DevisView.test.tsx`, describe dédié « noms
  lisibles sur une ligne de devis ») : nom du lot + programme affiché
  (jamais l'UUID brut en texte), nom de l'organisation candidate affiché
  (idem), les deux UUID accessibles via `title`/attribut technique, deux
  devis pour des organisations candidates différentes affichent chacun
  leur propre nom (pas de fuite entre lignes). Les tests existants qui
  vérifiaient encore l'UUID brut en texte ont été corrigés pour vérifier
  le nom résolu à la place — `makeDevis()` étend son objet par défaut avec
  `lot_detail`/`candidate_organization_detail` cohérents avec `lot`/
  `candidate_organization`. **274 tests frontend** sur les 5 packages
  (44+37+54+40+99), zéro régression, `tsc --noEmit` propre.
- **Vérifié dans un vrai navigateur, avec un vrai backend** (compte
  `admin_keyimmo` réel, lot et organisation candidate réels) : candidature
  réelle créée sur un lot fraîchement seedé (« Lot F029 », programme
  « Programme Verif F029 ») pour l'organisation « Bati Senegal Verif SARL »
  — la ligne affiche immédiatement « Lot F029 — Programme Verif F029 » et
  « Bati Senegal Verif SARL », jamais les UUID bruts en texte. Vérifié par
  inspection JS directe que les deux cellules portent bien `title`/
  `data-lot-id`/`data-organization-id` avec les UUID RÉELS exacts retournés
  par le backend (`f89aa1ab-...`/`efb63237-...`). Zéro erreur console.
  Nettoyage complet après coup (process `vite` orphelin tué manuellement,
  conteneur Postgres retiré, volume conservé).

## Explicitement hors scope
- `logged_by` reste un UUID brut — aucun champ `_detail` équivalent côté
  backend, hors scope de B-029 comme de ce ticket.
- Toute résolution de nom sur `DevisCandidateSerializer` (rôle
  constructeur) — hors périmètre admin de `DevisView`.

## Dépendances
Ticket B-028 (`LotSearchResult`/`OrganizationSearchResult`, types et
serializers réutilisés littéralement), ticket F-027 (`DevisView.tsx`,
structure générale de l'écran, `LotPicker`/`OrganizationPicker` déjà basés
sur ces mêmes types), **ticket B-029 (backend, fusionné — `lot_detail`/
`candidate_organization_detail` sur `DevisAdminSerializer`, base directe de
ce ticket)**.
