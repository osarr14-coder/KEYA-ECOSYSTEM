# F-058 — Écran back-office : instruction des demandes de programme (`apps/web`)

## Contexte

Suite de F-057 (écran `ProgramRequestView.tsx`, apps/home, où un prospect
« sponsor » soumet sa demande de bien sur mesure). F-057 laissait
explicitement ouvert : côté `admin_keyimmo`, la décision se prenait via
l'API directement (`curl`/admin Django), sans écran. Demande explicite
utilisateur : « Fais-le côté back-office (F-058) ». Même découpage que
B-039 (verrou) / F-049 (écran de création) / B-042 (fondations) / F-057
(écran prospect) : `apps/web` est réservé à `admin_keyimmo`, c'est donc
là que va l'écran d'instruction (accepter/refuser).

## Scope

- **`apps/web/src/api/types.ts`** — interface `ProgramRequest` (même
  forme que le serializer backend), avec commentaire rappelant que
  `status` n'est pas un `TrustLevel` et que `program` reste `null` tant
  que l'admin n'a pas créé le programme via l'assistant existant.
- **`apps/web/src/api/client.ts`** — `listProgramRequests(status?)` et
  `decideProgramRequest(requestId, organization, status)`, mêmes
  conventions que le reste du client (`request<T>()`, `toQueryString`).
- **`apps/web/src/views/ProgramRequestsView.tsx`** (nouveau) — liste
  filtrable par statut (défaut `en_attente`, la file actionnable —
  jamais un tableau de bord KPI au premier rendu, doctrine déjà établie
  côté BUILD), une carte par demande (organisation, email, date,
  description, statut), boutons Accepter/Refuser visibles uniquement
  pour une demande `en_attente`. `status` n'est PAS un `TrustLevel` —
  jamais `StatusBadge`, texte simple coloré (même raisonnement que
  `ProgramRequestView.tsx`, apps/home). Ne crée JAMAIS de `Program` —
  verrou B-039 intact : une fois acceptée, un rappel textuel invite
  l'admin à créer le programme depuis l'onglet « Programmes » existant
  (`ProgramsView.tsx`, F-049), en désignant l'organisation du demandeur
  (déjà affichée) comme organisation cible.
- **`apps/web/src/App.tsx`** — nouvel onglet « Demandes de programme »
  dans `TAB_DEFINITIONS` (route `/demandes-programme`, icône
  `clipboard-check`), suit le pattern `TAB_DEFINITIONS`
  source-de-vérité-unique déjà en place (aucune duplication séparée).

## Hors scope

- Aucune création automatique de `Program`/`Asset`/`Lot` depuis cet
  écran — verrou B-039 non négociable, la création reste un acte
  manuel et délibéré de l'admin via l'assistant existant.
- Aucune notification (email/push) au prospect lors de la décision —
  le prospect consulte son statut depuis `ProgramRequestView.tsx`
  (apps/home, F-057) en revenant sur l'écran.
- Aucune pagination/recherche texte — volume actuellement faible, même
  raisonnement que `list_program_requests_as_admin` côté backend
  (B-042, pas de plafond `MAX`).

## Critères d'acceptation

- `admin_keyimmo` voit la file « En attente » par défaut à l'ouverture.
- Changer le filtre de statut relance le chargement avec le bon
  paramètre (`''` → aucun paramètre, càd « Toutes »).
- Accepter/Refuser appelle l'API puis rafraîchit la liste ; les boutons
  disparaissent une fois la décision prise.
- Une demande acceptée sans programme encore créé affiche le rappel
  d'action vers l'onglet « Programmes ».
- Un échec de décision affiche une erreur locale (`AlertBanner`), un
  échec de chargement affiche `ApiErrorBanner` avec bouton Réessayer.
- Suite `apps/web` verte (201 tests, 12 nouveaux), `tsc --noEmit` propre.
- Vérifié en Chromium réel : liste (clair/sombre) et flux Accepter en
  bout en bout contre le backend local (statut passe à « Acceptée »,
  rappel affiché avec l'organisation cible correcte).
