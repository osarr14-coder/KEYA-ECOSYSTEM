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

## Découverte bloquante — aucun endpoint de recherche Lot/Organisation pour admin_keyimmo
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
fusionné au moment de ce ticket. En attendant, `DevisView` utilise une
saisie manuelle d'UUID (`LotSelector`, deux champs texte + bouton
« Charger ») avec un `AlertBanner` explicite expliquant pourquoi. Même
limite pour les champs de relation déjà connus (`candidate_organization`,
`logged_by`, `created_by` d'un ajustement) : `DevisAdminSerializer`/
`DevisAjustementAdminSerializer` sérialisent ces FK en UUID bruts
(`ModelSerializer` par défaut, aucun champ imbriqué côté backend) — affichés
tels quels, jamais un faux libellé masquant cette limite.

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
  supprimée) : `LotSelector` (saisie manuelle UUID + avertissement B-028),
  `DevisListPanel` (liste réelle, `useApiResource` + `reloadKey`),
  `CreateDevisForm`, `LockButton`, `AjustementsPanel` (fetch à la demande
  par devis verrouillé) + `CreateAjustementForm`. Tous les 409 affichent le
  message backend exact (`ApiError.detail`) via `AlertBanner`, jamais un
  message générique reconstruit côté frontend.
- `CandidateVisibleStatusNote` : reprend TEL QUEL le composant de la
  maquette (ticket 026) — « Gagnant » / « encore Candidat » dérivé
  localement de `devis.status === 'devis_verrouille' && ajustements.length
  > 0`. Ce n'est PAS un calcul métier frontend : la règle de gating elle-même
  vit exclusivement backend (`get_candidate_visible_devis_status`, ticket
  024) — ce composant affiche seulement, sur des données déjà exactes
  fraîchement chargées, une règle déjà vérifiée dans le code backend. Aucun
  second appel à `DevisCandidateSerializer` (réservé au rôle constructeur,
  hors périmètre admin de cet écran).

## Vérification
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

## Explicitement hors scope
- Tout sélecteur réel de lot/organisation (dépend de B-028, backend).
- Toute résolution de nom pour les UUID de relation affichés bruts (même
  dépendance).
- Vue côté rôle `constructeur` (`DevisCandidateSerializer`,
  `MyCandidaturesListView`/`Detail`) — hors périmètre admin de ce ticket.

## Dépendances
Ticket 011 (`GET /api/backoffice/users/?q=`, modèle de référence pour la
future recherche B-028), ticket 021 (`ApiError`, back-office, patterns de
confirmation/rechargement réel après écriture), ticket 022 (`Devis`,
`create_devis`/`lock_devis`), ticket 023 (`DevisAjustement`,
`create_ajustement`), ticket 024 (`get_candidate_visible_devis_status`),
ticket 025 (audit accessibilité + maquette initiale), ticket 026
(`marge_estimee` auto-dérivée, statut gagnant dans la maquette — base directe
de ce ticket), **B-028 (nouveau, transmis à la session backend — dépendance
bloquante non résolue par ce ticket)**.
