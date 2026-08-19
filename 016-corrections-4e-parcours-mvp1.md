# Ticket 016 — Corrections des bugs trouvés aux 4ᵉ et 5ᵉ parcours bout-en-bout

## Statut
Livré. Corrige trois bugs réels : deux trouvés en rejouant le test
bout-en-bout du vertical slice MVP 1 (doctrine V3.0 §22.4) une 4ᵉ fois, un
troisième trouvé en rejouant ce même parcours une 5ᵉ fois APRÈS les deux
premières corrections — aucun des trois n'était couvert par la suite
automatisée existante avant sa découverte. Aucune nouvelle fonctionnalité.

## Objectif
Chaque correction est précédée d'un test qui reproduisait le problème
observé pendant le parcours concerné, vérifié rouge puis vert.

## Corrections

### 1. `reserve_id` de mission scopé au LOT plutôt qu'à la mission (ticket 014 bis)
`apps.inspections.services.list_missions_for_inspector` dérivait `reserve_id`
via `_find_open_reserve_for_lot(lot)` — scopé au LOT entier, pas à la
mission. Une fois qu'une réserve s'ouvrait sur un lot (via une inspection
de suivi affectée après coup), TOUTE mission de ce lot — y compris une
première mission DÉJÀ terminée, affectée avant même que cette réserve
n'existe — héritait à tort du même `reserve_id`. Conséquence côté CONTROL
PWA : `MissionTypeIndicator` (ticket 014) affichait « Mission de suivi »
pour une mission déjà accomplie, simplement parce qu'une autre mission,
plus récente, avait depuis ouvert une réserve sur le même lot.

**Corrigé** en bornant temporellement l'attribution, même principe déjà
appliqué à `completed` (ticket 014) : une réserve n'est légitimement
« celle de cette mission » que si elle existait DÉJÀ au moment où la
mission a été affectée (`reserve.created_at <= mission.created_at`) —
sinon la mission ne pouvait structurellement pas en être la cause. Aucun
changement frontend nécessaire : `MissionTypeIndicator` dérivait déjà
correctement son libellé à partir de `reserveId` — seule la donnée
backend était fausse.

**Test de reproduction** (`apps/control/tests.py::TestMissionListView::
test_mission_row_exposes_reserve_id_when_the_lot_has_an_open_reserve`,
enrichi — même test que le ticket 013, dont l'ancienne assertion
`for mission_row in response.data: assert mission_row['reserve_id'] ==
str(reserve_id)` encodait justement le comportement fautif) : vérifié
rouge (`first_row['reserve_id']` non nul) avant correction, vert après.
`test_vertical_slice_mvp1.py` mis à jour de la même façon (assertion
manquante ajoutée, commentaire obsolète corrigé).

**Vérifié en conditions réelles au 5ᵉ parcours** : sur une mission de
première inspection déjà synchronisée puis une mission de suivi créée
après coup sur le même lot, CONTROL PWA affiche bien « Première inspection
/ Synchronisé » pour la première et « Mission de suivi — Réserve #… » pour
la seconde, sans confusion.

### 2. Lecture périmée traitée après relâchement du verrou (ticket 015 ter)
Le verrou `draftsInFlight` (ticket 015) empêche bien deux `syncDraft` de
tourner EN PARALLÈLE sur le même brouillon — confirmé au 4ᵉ parcours :
une seule Inspection créée malgré deux cycles `online` déclenchés
dos-à-dos. Mais il ne protège pas contre un second cycle qui a lu le
brouillon (`getAllDrafts()`, dans `runSyncCycle`) AVANT que le premier
n'ait fini d'écrire son propre résultat, puis qui n'appelle `syncDraft`
qu'UNE FOIS le verrou du premier déjà relâché : le verrou ne bloque plus
rien à ce moment-là, mais l'instantané transmis reste périmé — une photo
déjà synchronisée par le premier cycle s'y trouve encore `pending`, et se
réuploade (nouveau `Document` + nouvelle `Evidence` orpheline). Confirmé
au 4ᵉ parcours : logs backend (2 `POST /control/sync/documents/` à 15s
d'écart pour la même photo) et HOME affichant 4 preuves au lieu de 3.

**Corrigé** en relisant l'état RÉEL du brouillon depuis IndexedDB, SOUS le
verrou, avant tout traitement (`syncDraft` dans `syncEngine.ts`) — jamais
se fier au paramètre `draft` reçu seul, qui peut avoir été lu par un appel
concurrent avant que ce verrou ne soit posé. Puisque la relecture se fait
APRÈS l'acquisition du verrou, aucune nouvelle fenêtre de course n'est
introduite : tant que le verrou est tenu, aucun autre appel ne peut
modifier ce brouillon entre la relecture et le traitement.

**Test de reproduction** (`syncEngine.test.ts`, décrit AVANT correction,
confirmé rouge puis vert) : un instantané périmé est capturé EXPLICITEMENT
avant tout traitement (`getDraft` juste après `saveDraft`), le VRAI cycle
tourne à son terme (verrou posé puis relâché), PUIS `syncDraft` est
rappelé avec cet instantané périmé — reproduit exactement le
chevauchement visé sans dépendre d'un minutage hasardeux (l'ordre est
garanti par la structure du test, pas par une course réelle). Avant
correction : 2 appels à `/control/sync/documents/` et `/control/sync/
evidence/` pour la même photo. Après : 1 seul, `mediaSyncStatus` reste
`synced`.

### 3. `InspectionFormView` écrase les champs pilotés par le moteur de synchro (ticket 016 ter)
Trouvé en rejouant le 5ᵉ parcours (donc APRÈS les deux corrections
ci-dessus, déjà vertes en tests unitaires) : le même symptôme que le bug 2
réapparaissait en conditions réelles sur le scénario « photo ajoutée après
que la décision a déjà été synchronisée en arrière-plan ». Cause
distincte : `InspectionFormView.persist()` fusionne chaque saisie
(checklist, photo, décision, commentaire) sur `draftRef.current` — un état
React chargé UNE SEULE FOIS au montage du formulaire, jamais resynchronisé
avec les écritures que le moteur de synchro fait directement en IndexedDB
en arrière-plan (`syncStatus`, `knownLatestEventId`, `evidenceId`...).
Toute saisie suivante dans le même formulaire resté ouvert (ex. ajouter une
photo APRÈS que l'inspection a déjà été synchronisée) écrasait donc
silencieusement `syncStatus`/`knownLatestEventId` vers leur valeur
D'AVANT synchro, déclenchant une resoumission inutile de l'inspection —
rejetée à tort en conflit (409) par le serveur puisque le
`knownLatestEventId` envoyé était obsolète. Confirmé en conditions réelles
(navigateur + backend réel) : logs backend montrant une Inspection
`201` suivie, après ajout de la photo, d'un nouveau `POST
/control/sync/inspection/` inutile rejeté en `409`.

**Corrigé** en relisant l'état RÉEL du brouillon depuis IndexedDB juste
avant chaque écriture réelle (dans la chaîne sérialisée de `persist()`), et
en réappliquant la MÊME mutation sur cette base fraîche plutôt que sur
`current`/`next` — même principe déjà appliqué au moteur de synchro
lui-même (bug 2 ci-dessus), désormais aussi côté formulaire. Chaque
fonction `mutate` passée à `persist()` (`toggleChecklistItem`,
`handleCommentBlur`, `handleDecisionChange`, `handlePhotoAdd`,
`handlePhotoRemove`) n'opère que sur son paramètre, jamais sur une
fermeture — cette réapplication sur une base différente est donc sûre.

**Test de reproduction** (`InspectionFormView.test.tsx`, nouveau describe
block) : crée un brouillon réel via une vraie saisie, simule une synchro
d'arrière-plan complète via `patchDraft` (la fonction que le moteur utilise
réellement, jamais `saveDraft` — réservée aux saisies humaines), puis
ajoute une photo dans le MÊME formulaire resté ouvert. Vérifié rouge
(`syncStatus` retombait à `pending`, `knownLatestEventId` à sa valeur
d'origine) avant correction, vert après. Suite complète du fichier
(11/11) et `syncEngine.test.ts` (14/14) inchangés par ailleurs.

## Vérification manuelle — 5ᵉ parcours bout-en-bout
Le premier passage du 5ᵉ parcours (avant la découverte du bug 3) a
justement servi à révéler ce bug 3 en conditions réelles. Une fois corrigé,
le parcours a été rejoué proprement sur des missions neuves, jamais
touchées par les tentatives précédentes :

- Mission « conforme » : checklist + décision saisies, synchronisées en
  arrière-plan (`POST /control/sync/inspection/` → 201), PUIS photo
  ajoutée et deux événements `online` déclenchés dos-à-dos (scénario de
  concurrence du ticket 015 réinjecté) — un seul `POST
  /control/sync/documents/` et un seul `/evidence/`, aucune resoumission
  d'inspection, aucun conflit.
- Mission « avec réserve » : même séquence (décision synchronisée en
  arrière-plan, puis photo + double `online`) — même résultat propre,
  aucun conflit.
- BUILD : correction documentée sur la réserve ouverte (`POST
  /api/reserve-corrections/` → 201).
- CONTROL PWA : mission de suivi affichée correctement (« Mission de
  suivi — Réserve #… »), distincte de la mission de première inspection
  (« Première inspection / Synchronisé ») — confirme le bug 1 en
  conditions réelles.
- Nouvelle inspection sur la mission de suivi (décision conforme) :
  synchronisée sans incident (201), réserve résolue.
- BUILD : la réserve du lot concerné a disparu de « Réserves ouvertes »
  après résolution.

Aucun bug nouveau détecté sur ce parcours rejoué.

## Critères d'acceptation
- [x] Une mission déjà terminée n'hérite plus jamais du `reserve_id`
      d'une réserve ouverte par une AUTRE mission sur le même lot —
      testé par reproduction exacte du scénario observé, et vérifié en
      conditions réelles au 5ᵉ parcours
- [x] Un second cycle de synchro traitant une lecture périmée après
      relâchement du verrou ne réuploade jamais une photo/Evidence déjà
      synchronisée — testé par reproduction déterministe (sans sleep)
- [x] Une saisie dans `InspectionFormView` après une synchro en
      arrière-plan ne réécrase jamais `syncStatus`/`knownLatestEventId`
      vers leur état périmé d'avant synchro — testé par reproduction
      déterministe, et vérifié en conditions réelles (photo + décision +
      double `online`, sur mission `conforme` et `avec_reserve`)
- [x] Suite complète backend (182 tests, inchangée) et frontend (126
      tests, 4 workspaces — 125 + 1 nouveau test de reproduction)
      intégralement vertes
- [x] 5ᵉ parcours bout-en-bout manuel, rejoué APRÈS les trois
      corrections sur des missions neuves, avec les scénarios de
      concurrence du ticket 015 réinjectés, ne révèle aucun bug nouveau

## Explicitement hors scope
- Toute autre race potentielle non découverte pendant les 4ᵉ et 5ᵉ
  parcours
- La chaîne asynchrone non annulée de `startSyncEngine`'s `runIfOnline`
  (`refreshMissions(...).then(() => runSyncCycle(...))` ignore `stopped`
  une fois lancée) : latence de nettoyage préexistante repérée pendant
  l'investigation, sans impact démontré sur un cas réel (une seule vraie
  page chargée), laissée hors scope de ce ticket

## Dépendances
Tickets 013 (rapport bout-en-bout initial), 014 (`completed`,
`MissionTypeIndicator`), 015 (verrou `draftsInFlight`).
