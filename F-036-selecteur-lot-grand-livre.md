# Ticket F-036 — Second sélecteur de lot pour le grand-livre (apps/web)

## Statut

**Implémenté, testé, documenté.** 5 tests dédiés
(`apps/web/src/views/DevisView.test.tsx`), suite `web` 34 tests (+5),
suite frontend `web` 179 tests, `tsc --noEmit` propre.

## Origine

**F-035** (grand-livre de coûts par lot, `apps/procurement` B-035) avait
documenté un vrai trou de joignabilité, pas seulement un choix
d'ergonomie provisoire : `LotLedgerPanel` n'était monté que depuis l'état
`selectedLot` déjà sélectionné dans `DevisView` — un état React local,
jamais persisté. `LotPicker` (ticket B-028, `search_lots_as_admin`)
exclut par construction les lots déjà verrouillés (décision D) : dès que
`selectedLot` était perdu (rechargement de page, navigation), un lot
verrouillé devenait **définitivement introuvable** via l'UI, sans aucun
autre chemin pour recréer son grand-livre.

**B-037** (backend) a fermé ce trou côté API :
`GET /api/procurement/admin/lots/eligible-for-ledger/?q=` — critère
INVERSE de B-028 (lot déjà verrouillé, SANS `LotLedger` existant), même
forme de réponse (`LotSearchResultSerializer`, réutilisée telle quelle).
Ce ticket branche ce nouvel endpoint côté frontend.

## Décisions de conception

**A. Réutilisation TOTALE de `LiveSearchPicker<T>`** (composant générique
déjà partagé par `LotPicker`/`OrganizationPicker`, ticket B-028) — aucun
nouveau composant de recherche, seul un nouveau leaf `LotEligibleForLedgerPicker`
qui lui passe `api.searchLotsEligibleForLedger` comme `searchFn` et un
libellé distinct. Coût d'ajout minimal, comportement (debounce, garde
anti-course, états loading/erreur/vide, bouton Réessayer) hérité sans
rien réécrire.

**B. Bouton radio, JAMAIS les deux sélecteurs affichés en même temps** —
les deux recherches sont mutuellement exclusives par construction côté
backend (un lot est soit pas encore verrouillé, soit verrouillé sans
grand-livre, jamais les deux à la fois — voir la docstring de
`search_lots_eligible_for_ledger_as_admin`, ticket B-037) : afficher les
deux en parallèle n'aurait aucun sens et risquerait une ambiguïté sur
quel sélecteur vient de répondre. Un `role="radiogroup"` simple, cohérent
avec le style HTML minimal déjà utilisé dans ce fichier (pas de
composant de design system dédié pour un radio).

**C. Une fois un lot sélectionné via l'un OU l'autre sélecteur, MÊME flux
que jusqu'ici** — `DevisListPanel` ne distingue jamais par quel chemin
`selectedLot` a été peuplé, aucune logique dupliquée : un lot trouvé via
le second sélecteur est déjà verrouillé par construction, donc
`LotLedgerPanel` se monte immédiatement dans `DevisListPanel`, exactement
le résultat recherché.

**D. `searchMode` (état du bouton radio) PERSISTE après « Changer de
lot »** — décision implicite, pas un oubli : si l'admin cherchait un lot
verrouillé, revenir au sélecteur après avoir changé d'avis doit rester
sur CE mode, pas repartir sur « lot ouvert » par défaut.

## Limite résiduelle assumée — PAS corrigée par ce ticket

**Un lot qui a DÉJÀ un `LotLedger` reste, lui, introuvable une fois la
session perdue.** `search_lots_eligible_for_ledger_as_admin` l'exclut
aussi — au plus un grand-livre par lot (décision B, ticket B-035), donc
un lot avec grand-livre n'est plus « éligible à la création ». **Aucun
endpoint backend actuel ne permet de rechercher un lot verrouillé
indépendamment de l'existence de son grand-livre.** Ce ticket ferme le
trou de joignabilité pour la CRÉATION d'un grand-livre, pas pour la
CONSULTATION ultérieure d'un grand-livre déjà créé — candidat explicite
pour un futur ticket (backend : nouvel endpoint ou paramètre ; frontend :
troisième mode de recherche) si ce second trou doit être fermé.

## Entités touchées

- `apps/web/src/api/client.ts` — nouvelle méthode `searchLotsEligibleForLedger`,
  mince wrapper HTTP (même forme que `searchLots`).
- `apps/web/src/views/DevisView.tsx` — nouveau composant
  `LotEligibleForLedgerPicker` ; `DevisView` gagne un bouton radio
  (`searchMode`) qui bascule entre `LotPicker`/`LotEligibleForLedgerPicker`.
- `apps/web/src/testUtils.tsx` — `createMockApiClient` : nouvelle entrée
  par défaut `searchLotsEligibleForLedger` (rejette par défaut, même
  discipline que toutes les autres méthodes du mock).
- `apps/web/src/views/DevisView.test.tsx` — 5 tests dédiés + une nouvelle
  fixture `ELIGIBLE_LOT_RESULT` (distincte de `LOT_RESULT`, pour prouver
  que le bon sélecteur affiche ses propres résultats).

## Scope inclus

- Second sélecteur de lot, branché sur B-037, mutuellement exclusif avec
  `LotPicker`.
- Documentation de la limite résiduelle (grand-livre déjà créé).

## Explicitement hors scope

- **Fermeture du second trou de joignabilité** (lot avec grand-livre déjà
  créé) — nécessiterait un nouvel endpoint/paramètre backend, hors scope
  de ce ticket, documenté comme limite assumée.
- **Toute modification de `LiveSearchPicker`/`LotPicker`/`OrganizationPicker`**
  — réutilisés tels quels.
- **Toute modification de `LotLedgerPanel`** (F-035/F-035 bis) — ce
  ticket ne change QUE le CHEMIN pour y accéder, jamais son contenu.

## Critères d'acceptation

- [x] Le sélecteur « lot ouvert » (`LotPicker`) reste affiché PAR DÉFAUT,
      comportement inchangé pour tout utilisateur qui ne touche pas au
      bouton radio.
      (`test('affiche le sélecteur "lot ouvert" par défaut...')`)
- [x] Basculer sur « Lot déjà verrouillé (grand-livre) » affiche le
      second sélecteur ET appelle EXCLUSIVEMENT
      `searchLotsEligibleForLedger` (jamais `searchLots`).
      (`test('basculer sur ... appelle searchLotsEligibleForLedger...')`)
- [x] Les deux sélecteurs ne sont JAMAIS affichés simultanément, dans les
      deux sens de bascule.
      (`test('revenir sur "Lot ouvert" ... réaffiche LotPicker...')`)
- [x] Sélectionner un lot depuis le second sélecteur mène au MÊME écran
      de détail (`DevisListPanel`) que `LotPicker`, avec le bon
      `lot.id`/`organization.id` transmis à `listDevisForLot`.
      (`test('sélectionner un lot depuis le second sélecteur mène au
      même écran...')`)
- [x] Un échec réseau sur le second sélecteur affiche une erreur
      explicite, indépendamment de `searchLots`.
      (`test('un échec réseau sur le second sélecteur affiche une
      erreur explicite...')`)
- [x] `tsc --noEmit` propre.
- [x] Documentation (fichier ticket + section `CLAUDE.md`), tests écrits
      avant de considérer le ticket terminé, y compris la limite
      résiduelle identifiée.

## Notes d'implémentation

**Synchronisation vérifiée AVANT d'écrire du code** — cette branche
(`feature/frontend-round-2`) était 3 commits derrière `origin/master`
(B-037 + réconciliation F-035/B-037) : `git fetch`/`merge` faits en
premier, contrat backend (`GET .../eligible-for-ledger/`) revérifié
directement dans `backend/apps/procurement/{urls,views}.py` avant
d'écrire la moindre ligne côté frontend — leçon explicitement tirée de
F-035 bis (dépendance affirmée « manquante » à tort faute de
synchronisation), appliquée ici dès le départ plutôt que découverte après
coup.

**Aucune anomalie trouvée en écrivant les tests** — `LotSearchResult` et
`LotSearchResultSerializer` sont déjà identiques entre les deux
endpoints (même serializer côté backend), aucune adaptation de type
nécessaire côté frontend.

5 tests dédiés, suite `web` 179 tests, `tsc --noEmit` propre.
