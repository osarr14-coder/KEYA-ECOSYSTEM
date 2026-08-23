# F-057 — Écran frontend : demande de programme sur mesure (`apps/home`)

## Contexte

Suite de B-042 (fondations backend `ProgramRequest`) : ferme le point
explicitement laissé ouvert (« aucun écran frontend »), même découpage
que B-039 (verrou) / F-049 (écran). Un prospect « sponsor » (bien sur
mesure, jamais un lot existant — voir `apps.accounts.serializers.
SELF_SERVICE_ROLES`) doit pouvoir soumettre sa demande et suivre son
statut. `apps/home` est la seule app déjà orientée « rôle client final »
(HOME, ticket 008), le rôle `sponsor` y était déjà prévu (module FINANCE
gated, jamais implémenté) — écran ajouté ici, pas dans `apps/web`
(réservé à `admin_keyimmo`, jamais un prospect).

## Découverte en cours de conception

`App.tsx` (HOME) supposait implicitement qu'un utilisateur a TOUJOURS au
moins un `Lot` — un sponsor sans bien (son cas normal AVANT que sa
demande soit acceptée) tombait sur le message générique « Aucun bien ne
vous est encore associé. » et RIEN D'AUTRE : aucun onglet, aucune
navigation, aucun moyen d'atteindre un écran de demande. Corrigé en
distinguant ce cas explicitement (voir Scope).

## Scope

- **`apps/home/src/api/client.ts`** — première écriture de cette app
  (jusqu'ici strictement lecture seule, ticket 008) : `request()` gagne
  un corps JSON optionnel, même forme que `apps/web/src/api/client.ts`
  (ticket 022), pas un mécanisme réinventé. `getMyProgramRequests`/
  `createProgramRequest` ajoutés.
- **`apps/home/src/views/ProgramRequestView.tsx`** (nouveau) — formulaire
  de soumission (`Card` + `<textarea>` stylé aux mêmes tokens que
  `Input.tsx`, aucun composant `Textarea` partagé n'existe encore dans le
  design system) + liste des demandes déjà soumises avec leur statut.
  `status` (`en_attente`/`acceptee`/`refusee`) n'est PAS un `TrustLevel`
  — jamais `StatusBadge`, même raisonnement que `SyncStatusIndicator`/
  `MissionTypeIndicator` (CONTROL PWA) : simple texte, aucun second
  consommateur ne réclame un badge partagé pour ce vocabulaire précis.
  Ne crée JAMAIS de `Program` — verrou B-039 intact, `admin_keyimmo`
  instruit la demande séparément via le wizard existant (F-049).
- **`apps/home/src/App.tsx`** :
  - Un sponsor SANS bien voit directement `ProgramRequestView`, jamais
    le message générique (qui n'a aucun sens pour lui).
  - Un sponsor AVEC au moins un bien voit un onglet supplémentaire
    « Programme sur mesure » EN PLUS des onglets liés à un bien (jamais
    à leur place) — il peut soumettre une nouvelle demande même s'il
    possède déjà un projet en cours.
  - Un client (rôle `client`) ne voit jamais cet écran ni cet onglet —
    comportement strictement inchangé pour ce rôle.

## Hors scope

- Aucun écran d'accepter/refuser côté `admin_keyimmo` (apps/web) — la
  décision continue de se prendre via l'API directement (`curl`/admin
  Django) jusqu'à un futur ticket dédié à l'écran back-office, si le
  besoin se confirme.
- Aucune vitrine publique — un sponsor doit toujours s'inscrire d'abord
  (cohérent avec B-042, hors scope déjà documenté là-bas).

## Critères d'acceptation

- Un sponsor sans bien voit le formulaire de demande dès la connexion,
  jamais le message générique.
- Un client sans bien voit toujours le message générique, comportement
  inchangé.
- Soumettre une demande vide est bloqué côté UI (bouton désactivé) et
  côté API (400, déjà couvert par B-042).
- Les demandes déjà soumises s'affichent avec leur statut, sans jamais
  créer de `Program`.
- Suite `apps/home` verte (76 tests, 12 nouveaux), `tsc --noEmit` propre.
- Vérifié en Chromium réel (sponsor sans bien, sponsor avec bien,
  clair/sombre).
