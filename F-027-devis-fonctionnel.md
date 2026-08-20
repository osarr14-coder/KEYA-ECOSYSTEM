# Ticket 027 (F-027) — Devis/Appels d'offres : écrans fonctionnels réels

## Statut
Livré. Branche `feature/frontend-round-2`. Transforme la maquette visuelle
`DevisAppelOffreMockup.tsx` (tickets 025/026) en écran fonctionnel réel
(`DevisView.tsx`), connecté à l'API backend stable (`apps/procurement`,
tickets 022/023/024/025-backend/026-backend). Périmètre `admin_keyimmo`
uniquement, conforme à la décision de conception 1 du ticket 022 (« admin
saisit tout »).

## Vérification du contrat API — avant tout code, comme d'habitude
Lecture directe et complète de `backend/apps/procurement/{models,services,
serializers,views}.py` et `backend/apps/pricing/{views,serializers}.py`
avant d'écrire une ligne de frontend :

- `POST /api/procurement/devis/` — `{organization, lot, candidate_organization,
  amount}`. **`marge_estimee` n'est plus un champ d'entrée depuis le ticket
  026-backend** — dérivée exclusivement du `PricingConfig` `canal_1_marge`
  actif pour le pays du LOT. 409 (`{detail}`) si le lot est déjà verrouillé
  (`LotAlreadyLockedError`) ou si aucun `PricingConfig` actif n'existe
  (`NoPricingConfigError`).
- `POST /api/procurement/devis/{id}/lock/` — `{organization}`. 409 si un
  devis est déjà verrouillé pour ce lot.
- `GET /api/procurement/admin/lots/{lot_id}/devis/?organization_id=...` —
  seul endpoint exposant les montants (`DevisAdminSerializer`), statut RÉEL
  (`get_devis_status`, jamais gaté).
- `GET/POST /api/procurement/devis/{id}/ajustements/` — `POST` : `{organization,
  ecart}` (signé), 409 si devis pas verrouillé (`DevisNotLockedError`) ou
  marge dépassée (`MarginExceededError`), réponse avec `marge_resultante`
  (absent du `GET`, qui ne renvoie que l'historique).

**Écart de vocabulaire avec la demande initiale** : « lancement d'un appel
d'offres » n'a pas de contrepartie backend distincte — ticket 022 a fusionné
volontairement candidature et devis en une seule table (voir
`022-verrouillage-devis-mise-en-concurrence.md`). Il n'existe aucune notion
de lot « mis en appel d'offres » ouvert/fermé indépendamment des devis
eux-mêmes : chaque `POST /api/procurement/devis/` EST l'acte d'enregistrer
une candidature reçue hors plateforme. `DevisView` reflète ce modèle tel
quel plutôt que d'inventer une action « lancer l'appel d'offres » côté
frontend qui n'aurait aucun endpoint à appeler.

## Découverte bloquante — aucun endpoint de recherche Lot/Organisation pour admin_keyimmo (RÉSOLUE, voir section dédiée ci-dessous)
`GET /api/programs/lots/` et `GET /api/build/lots/` sont tous deux
strictement scopés à `request.organization` (l'organisation dont
l'utilisateur est MEMBRE) — aucun des deux n'expose même le champ
`organization` du lot. `apps/organizations/urls.py` n'existe pas : aucun
endpoint ne liste les organisations. Or `admin_keyimmo` n'est structurellement
jamais membre des organisations avec lesquelles il interagit ici (même
raison que `create_inspection`, ticket 005 : bascule RLS explicite vers une
organisation cible, jamais une organisation dont l'acteur est membre).

**Décision actée avec l'utilisateur** (voir échange de ce ticket) : ticket
**B-028** (endpoints de recherche `GET /api/procurement/admin/lots/?q=`/
`GET /api/procurement/admin/organizations/?q=`, sur le modèle de `GET
/api/backoffice/users/?q=`, ticket 011) transmis à la session backend,
documenté ici comme DÉPENDANCE BLOQUANTE pour un sélecteur — pas encore
fusionné au moment de la livraison initiale de ce ticket. En attendant,
`DevisView` utilisait une saisie manuelle d'UUID (`LotSelector`, deux champs
texte + bouton « Charger ») avec un `AlertBanner` explicite expliquant
pourquoi. **B-028 a depuis été fusionné dans `master` — voir la section
« Levée de la dépendance B-028 » ci-dessous, qui remplace cette saisie
manuelle par un vrai sélecteur.** Limite résiduelle à l'époque, distincte et
NON résolue par B-028 : les champs de relation d'un devis DÉJÀ créé
(`candidate_organization`, `lot`, `logged_by`, `created_by` d'un ajustement)
restaient des UUID bruts dans la table (`DevisAdminSerializer`/
`DevisAjustementAdminSerializer`, `ModelSerializer` par défaut, aucun champ
imbriqué). **`candidate_organization`/`lot` résolus depuis, ticket F-029**
(voir `F-029-noms-lisibles-devis.md`) — `logged_by`/`created_by` restent des
UUID bruts, toujours hors scope.

## Levée de la dépendance B-028 (sélecteur réel de lot/organisation)

Suite directe de ce même ticket, une fois **B-028** (`feat(procurement):
ticket B-028 — recherche Lot/Organisation pour admin_keyimmo`) fusionné dans
`origin/master`. Contrat API revérifié directement dans le code backend
avant tout changement, comme d'habitude — lecture complète de
`backend/apps/procurement/{views,serializers,services}.py` :

- `GET /api/procurement/admin/lots/?q=<recherche>` (`AdminLotSearchView`,
  `IsAdminKeyimmo`) → `LotSearchResultSerializer`, liste de `{id, name,
  organization: {id, name}, program: {id, name}}`. `q` vide → liste vide
  (jamais un dump complet, même discipline que `GET /api/backoffice/
  users/?q=`, ticket 011).
- `GET /api/procurement/admin/organizations/?q=<recherche>`
  (`AdminOrganizationSearchView`, `IsAdminKeyimmo`) → `{id, name}[]`.
- **Lots DÉJÀ verrouillés exclus par le backend lui-même**
  (`apps.procurement.services.search_lots_as_admin`, décision D : l'appel à
  `is_lot_locked` a lieu DANS la boucle de recherche, sous la bascule RLS déjà
  positionnée sur l'organisation du lot candidat) — vérifié à la fois en
  lisant le code (`if is_lot_locked(lot.id): continue`) et en navigateur réel
  (voir Vérification ci-dessous), jamais un filtre reconstruit côté
  frontend.

**Ce qui change dans `DevisView.tsx`** :
- `LotSelector` (saisie manuelle de deux UUID) **supprimé**, remplacé par
  `LotPicker` — recherche en direct (debounce 250ms,
  `useDebouncedSearch`/`SEARCH_DEBOUNCE_MS`) sur `searchLots`, résultats
  rendus `${lot.name} — ${lot.program.name} (${lot.organization.name})` :
  le nom du programme désambiguïse deux lots homonymes dans des programmes
  différents (cas réel testé, voir Vérification). Sélectionner un résultat
  fournit DIRECTEMENT `organization.id`/`lot.id` — plus besoin de deux
  champs séparés, la recherche par nom de lot suffit à elle seule.
- `CreateDevisForm` : le champ `Organisation candidate (UUID)` **supprimé**,
  remplacé par `OrganizationPicker` (même recherche en direct sur
  `searchOrganizations`) — le bouton « Enregistrer la candidature » reste
  désactivé tant qu'aucune organisation n'est sélectionnée.
- `LiveSearchPicker<T>` : composant générique partagé entre les deux
  sélecteurs (libellé/fonction de recherche/rendu de résultat en props) —
  une seule implémentation du debounce et du rendu liste/erreur/vide,
  jamais deux copies.
- **Garde anti-course dans `useDebouncedSearch`** : un `clearTimeout` seul
  n'annule que les requêtes pas encore PARTIES — une requête déjà en vol
  quand une frappe plus récente la dépasse est explicitement ignorée à sa
  résolution (comparaison contre `latestQueryRef.current`, jamais appliquée
  par-dessus un résultat plus frais), même discipline anti-course que
  `syncEngine.ts` (CONTROL PWA, tickets 015/016).
- Aucun autre composant touché : `DevisListPanel`/`DevisRow`/`LockButton`/
  `AjustementsPanel`/`CreateAjustementForm`/`CandidateVisibleStatusNote`
  reçoivent toujours `organizationId`/`lotId` en props, désormais dérivés du
  lot sélectionné plutôt que saisis à la main — comportement inchangé.

**Critères d'acceptation F-027 concernés, réexaminés** :
- « Sélection du lot/organisation candidate » : passe de « saisie manuelle
  d'UUID, dépendance bloquante documentée » à **réellement satisfait** —
  recherche en direct, résultats désambiguïsés par le programme.
- « Aucune donnée de relation jamais masquée derrière un faux libellé » :
  reste satisfait, sous une forme réduite — seules les lignes de devis DÉJÀ
  créées (table `DevisRow`) affichent encore des UUID bruts pour
  `candidate_organization`/`logged_by`, `DevisAdminSerializer` n'ayant pas
  été touché par B-028. Documenté explicitement, pas silencieusement laissé
  de côté.
- Les autres critères (création, verrouillage, ajustement, gating candidat,
  gestion des 409) sont inchangés par cette passe — aucune régression sur
  leur comportement, seule la façon de désigner lot/organisation change.

## Ce qui a été construit
- `apps/web/src/api/types.ts` : `DevisStatus`, `Devis`, `DevisAjustement`,
  `DevisAjustementCreateResult` — miroirs exacts des serializers admin.
- `apps/web/src/api/client.ts` : `listDevisForLot`, `createDevis`,
  `lockDevis`, `listAjustements`, `createAjustement`. `ApiError` gagne un
  champ `detail?: string` — le `request()` générique lit désormais le corps
  d'une réponse d'erreur pour en extraire `{detail}` (409 métier), sans
  changer le comportement des appelants existants (back-office, ticket 021)
  qui n'en avaient jamais besoin.
- `apps/web/src/views/DevisView.tsx` (remplace `DevisAppelOffreMockup.tsx`,
  supprimée) : `LotPicker`/`OrganizationPicker` (recherche en direct via
  `LiveSearchPicker<T>`, voir section « Levée de la dépendance B-028 »),
  `DevisListPanel` (liste réelle, `useApiResource` + `reloadKey`),
  `CreateDevisForm`, `LockButton`, `AjustementsPanel` (fetch à la demande
  par devis verrouillé) + `CreateAjustementForm`. Tous les 409 affichent le
  message backend exact (`ApiError.detail`) via `AlertBanner`, jamais un
  message générique reconstruit côté frontend.
- `apps/web/src/api/types.ts`/`client.ts` : `LotSearchResult`,
  `OrganizationSearchResult`, `searchLots`, `searchOrganizations` — miroirs
  exacts de `LotSearchResultSerializer`/`OrganizationSearchResultSerializer`
  (ticket B-028).
- `CandidateVisibleStatusNote` : reprend TEL QUEL le composant de la
  maquette (ticket 026) — « Gagnant » / « encore Candidat » dérivé
  localement de `devis.status === 'devis_verrouille' && ajustements.length
  > 0`. Ce n'est PAS un calcul métier frontend : la règle de gating elle-même
  vit exclusivement backend (`get_candidate_visible_devis_status`, ticket
  024) — ce composant affiche seulement, sur des données déjà exactes
  fraîchement chargées, une règle déjà vérifiée dans le code backend. Aucun
  second appel à `DevisCandidateSerializer` (réservé au rôle constructeur,
  hors périmètre admin de cet écran).

## Vérification (livraison initiale, sélection manuelle d'UUID)
- **254 tests frontend** sur les 5 packages (web 79, dont 16 nouveaux pour
  `DevisView` — sélection manuelle, liste, verrouillage y compris
  `lotAlreadyLocked`, création de candidature, ajustements avec les deux
  statuts vue candidat, tous les cas 409 avec `ApiError.detail`). `App.test.tsx`
  mis à jour (assertions sur l'ancien texte de maquette remplacées). `tsc
  --noEmit` propre sur `apps/web`.
- **Vérifié dans un vrai navigateur, avec un vrai backend** (compte
  `admin_keyimmo` réel, Postgres réel, `PricingConfig` réel à 12 % pour le
  Sénégal) : parcours complet — chargement d'un lot vide (« Aucun devis
  enregistré pour ce lot. »), enregistrement d'une candidature réelle
  (`marge_estimee` auto-dérivée à 1 500 000 pour un montant de 12 500 000,
  confirmant le calcul backend du ticket 026), verrouillage réel, ajustement
  favorable (-200 000) faisant bien passer la vue candidat de « encore
  Candidat » à « Gagnant », un second ajustement délibérément excessif
  (2 000 000) refusé avec le message backend EXACT (« Écart (2000000.00)
  au-delà de la marge disponible (1700000.00). »), et une seconde
  candidature sur le même lot refusée avec le message backend exact
  (« La mise en concurrence de ce lot est déjà verrouillée — aucun nouveau
  devis accepté. »). Zéro erreur console pendant le parcours réel (les
  quelques 401 observés provenaient d'un jeton `localStorage` périmé d'une
  vérification antérieure, purgé avant de commencer). Nettoyage complet
  après coup (serveurs arrêtés, y compris un process `vite` orphelin sur le
  port 5176 que `TaskStop` seul ne tue pas — piège d'environnement déjà
  documenté au ticket 021 —, conteneur Postgres retiré ; volume Postgres
  conservé, données de vérification `-verif`/F027 laissées en place pour de
  futures sessions, même convention que les tickets précédents).

## Vérification (levée de la dépendance B-028, sélecteur réel)
- **`DevisView.test.tsx` réécrit** (19 tests, contre 16 avant) : sélection
  de lot par recherche (résultats désambiguïsés par programme, absence de
  résultat, échec réseau, changement de lot), sélection d'organisation
  candidate par recherche, bouton de candidature désactivé tant qu'aucune
  organisation n'est choisie — le reste (verrouillage, ajustements, gating,
  409) inchangé dans son comportement, adapté seulement dans son
  déclenchement (sélection réelle au lieu de saisie d'UUID). **Piège de test
  rencontré et corrigé avant tout lancement propre** : une première version
  combinait `vi.useFakeTimers()` (pour avancer le debounce de 250ms) avec le
  polling interne de `findByRole`/`waitFor` de Testing Library — qui utilise
  aussi `setTimeout` en interne. Les deux minuteries faussées entraient en
  conflit (15/19 tests en timeout à 5000ms) : corrigé en abandonnant les
  fake timers, le debounce (250ms) étant assez court pour qu'un `findBy*`
  en temps réel (timeout par défaut 1000ms) le couvre naturellement — plus
  simple et plus proche de ce qu'un vrai navigateur exécute. 82/82 tests
  `apps/web` (5 packages : 254 tests, inchangé ailleurs), `tsc --noEmit`
  propre.
- **Vérifié dans un vrai navigateur, avec un vrai backend** (compte
  `admin_keyimmo` réel) : deux lots RÉELS nommés identiquement (« Lot A12 »)
  dans deux programmes différents du même `Org Constructeur Verif`, seedés
  spécifiquement pour prouver la désambiguïsation — recherche "A12" renvoie
  bien les deux, distingués par leur libellé `{name} — {program.name}
  ({organization.name})` (confirmé par `GET /api/procurement/admin/
  lots/?q=A12` → 200, deux résultats). Sélection d'un lot, recherche et
  sélection réelle de l'organisation candidate (`GET /api/procurement/
  admin/organizations/?q=Bati` → 200), candidature créée, verrouillée.
  **Critère d'exclusion vérifié explicitement** (pas seulement lu dans le
  code) : après verrouillage, un retour à la recherche "A12" ne renvoie plus
  que le second lot (non verrouillé) — le premier, désormais verrouillé, a
  disparu des résultats, confirmant `search_lots_as_admin`/décision D en
  conditions réelles. Zéro erreur console. Nettoyage complet (process `vite`
  orphelin sur le port 5176 tué manuellement — même piège que la vérification
  précédente —, conteneur Postgres retiré, volume conservé). **Anomalie
  observée sans lien avec ce changement** : les lignes `Lot`/`Membership`
  seedées lors de la vérification précédente avaient disparu du volume
  Postgres persistant entre les deux sessions de vérification (`Organization`/
  `PricingConfig`/`User` intacts) — cause non investiguée plus avant
  (hypothèse la plus probable : une exécution de la suite backend complète
  entre les deux, bien que `settings_test.py` devrait pointer sur une base
  `test_*` distincte) ; re-seedé sans incident, comportement de ce ticket
  non affecté.

## Explicitement hors scope
- ~~Toute résolution de nom pour les UUID de relation déjà présentes sur un
  devis créé (`candidate_organization`/`lot` dans `DevisRow`)~~ — **résolu
  au ticket F-029** une fois B-029 (backend) fusionné : `DevisAdminSerializer`
  gagne `lot_detail`/`candidate_organization_detail`, consommés par
  `DevisView`. Voir `F-029-noms-lisibles-devis.md`.
- `logged_by`/`created_by` (dans `DevisRow`/`AjustementsPanel`) restent des
  UUID bruts — `DevisAjustementAdminSerializer` n'a pas été touché par
  B-029, et B-029 lui-même n'a pas résolu `logged_by`. Toujours hors scope.
- Vue côté rôle `constructeur` (`DevisCandidateSerializer`,
  `MyCandidaturesListView`/`Detail`) — hors périmètre admin de ce ticket.

## Dépendances
Ticket 011 (`GET /api/backoffice/users/?q=`, modèle de référence pour la
recherche B-028), ticket 021 (`ApiError`, back-office, patterns de
confirmation/rechargement réel après écriture), ticket 022 (`Devis`,
`create_devis`/`lock_devis`), ticket 023 (`DevisAjustement`,
`create_ajustement`), ticket 024 (`get_candidate_visible_devis_status`),
ticket 025 (audit accessibilité + maquette initiale), ticket 026
(`marge_estimee` auto-dérivée, statut gagnant dans la maquette — base directe
de ce ticket), **ticket B-028 (backend, fusionné — endpoints de recherche
Lot/Organisation, dépendance désormais LEVÉE par la section « Levée de la
dépendance B-028 » ci-dessus)**.
