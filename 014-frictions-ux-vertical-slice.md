# Ticket 014 — Frictions UX identifiées durant le rapport bout-en-bout (ticket 013)

## Statut
Livré. Corrige trois frictions UX/correction réelles laissées de côté par
les tickets 013 (bugs bloquants) et 015 (races de concurrence), toutes
trois issues du même test bout-en-bout du vertical slice MVP 1 (doctrine
V3.0 §22.4). Aucune nouvelle fonctionnalité — corrections sur du code déjà
livré aux tickets 010/012/013.

## Objectif
Chaque friction identifiée dans le rapport a été corrigée, avec un test
qui reproduisait le problème AVANT correction (vérifié rouge, puis vert).

## Corrections

### 1. Missions indistinguables dans CONTROL PWA
`MissionsListView.tsx` n'affichait ni `reserve_id`, ni aucun moyen de
distinguer une première inspection d'une mission de suivi — deux entrées
de liste strictement identiques (même lot, même bien, même jalon) alors
que l'une exige une décision sur un lot déjà réservé et l'autre non.

**Corrigé** par `MissionTypeIndicator` (`MissionsListView.tsx`), un
composant LOCAL — PAS `StatusBadge` du design system : le type de mission
(première inspection / suivi) n'est pas un des 5 niveaux `TrustLevel`
Visible Trust, même raisonnement déjà appliqué à `SyncStatusIndicator`/
`AlertBanner` (tickets 007/008/010) — réutiliser `StatusBadge` ici aurait
laissé croire, à tort, qu'un type de mission EST un niveau de confiance.
Affiche « Première inspection » ou « Mission de suivi — Réserve
#<8 premiers caractères de l'UUID> », dérivé de `mission.reserveId`
(exposé côté backend depuis le ticket 013, jamais recalculé côté
frontend). Référence courte de l'UUID plutôt que `Reserve.description` :
ce champ existe sur le modèle mais n'est **en pratique jamais renseigné**
nulle part dans le code actuel (toujours vide) — l'exposer aurait été
trompeur, pas une vraie différenciation.

**Test de reproduction** (`MissionsListView.test.tsx`) : deux missions
seedées, l'une avec `reserveId` non nul, vérifié rouge (aucun texte
« Mission de suivi » nulle part) avant correction, vert après (la
référence courte de la réserve apparaît bien dans l'item concerné, jamais
dans l'autre).

### 2. Statut "completed" mal dérivé pour une mission de suivi
`apps.inspections.services.list_missions_for_inspector` dérivait
`completed` en filtrant `Inspection` par `work_declaration_id`+
`inspector` SEULS, sans aucune borne par mission — une mission de suivi
fraîchement affectée, créée APRÈS qu'une première inspection ait déjà eu
lieu sur ce même `work_declaration`, retrouvait cette ancienne
`Inspection` dans la requête et s'affichait donc déjà « faite » avant
même que l'inspecteur n'y touche. Documenté comme limite connue, non
résolue, dans le rapport du ticket 013 — corrigé ici.

**Corrigé** en ajoutant `created_at__gt=mission.created_at` au filtre :
seule une `Inspection` VRAIMENT postérieure à CETTE mission peut
légitimement l'avoir accomplie — la seule information disponible pour
distinguer une mission d'une autre sur le même `work_declaration`, aucun
champ `reserve` n'existant sur `InspectionMission` elle-même (doctrine
Visible Trust : rien n'est stocké qui puisse se dériver).

**Test de reproduction** (`apps/control/tests.py::TestMissionListView::
test_a_follow_up_mission_is_not_completed_before_its_own_inspection_exists`)
: première inspection soumise (ouvre une réserve), mission de suivi créée
ensuite — vérifié rouge (`completed is True` à tort) avant correction,
vert après. Le test bout-en-bout (`test_vertical_slice_mvp1.py`), qui
documentait explicitement cette limite comme acceptée, a été mis à jour
pour vérifier le comportement CORRECT plutôt que de continuer à figer
l'ancien bug comme comportement attendu.

### 3. Dropdown de preuves illisible dans BUILD
Le formulaire "Documenter une correction" (`ExceptionsView.tsx`,
`ReserveCorrectionForm`) affichait chaque preuve disponible comme
`{milestone_label} — {date}` seul — cinq preuves du même jalon soumises
le même jour apparaissaient toutes comme "Foncier — 16/08/2026",
strictement indiscernables, sans moyen de savoir laquelle sélectionner.

**Corrigé** en ajoutant l'auteur (`Evidence.added_by.email`) au libellé,
et en affichant l'heure en plus de la date (`toLocaleString` plutôt que
`toLocaleDateString`) : `{milestone_label} — {added_by_email} —
{date+heure}`. Backend (`apps/build/services.py::_bulk_work_declarations`)
: `.select_related('added_by')` ajouté à la requête déjà groupée — un
JOIN, JAMAIS une requête supplémentaire par preuve, critère central du
ticket 009 (nombre de requêtes BORNÉ, indépendant du nombre de lots) resté
intact et revérifié (`TestAllLotsScalesToTwoHundredLots`, toujours vert).

**Test de reproduction** : backend
(`apps/build/tests.py::TestReservesOuvertes::
test_available_evidence_rows_expose_the_author_to_differentiate_entries`,
vérifié rouge — `KeyError: 'added_by_email'` — avant correction) et
frontend (`ExceptionsView.test.tsx`, deux preuves du même jalon/jour avec
des auteurs différents, vérifié rouge — libellés identiques — avant
correction, vert après — chaque `<option>` porte l'email de son auteur).

## Plugin UI/UX installé — vérifié, non utilisé ici
Le skill `ui-ux-pro-max` (styles/palettes/UX/accessibilité) a été
consulté pour une éventuelle recommandation sur la différenciation
d'éléments de liste — rien de directement applicable trouvé au-delà d'un
principe d'accessibilité déjà respecté (ne jamais distinguer par la
couleur seule). Les trois corrections restent sur les composants du
design system déjà en place (aucun composant nouveau créé hors de
`packages/design-system` — `MissionTypeIndicator` suit exactement le
précédent déjà établi de `SyncStatusIndicator`, local à son app, comme
demandé) ; `apps/control-pwa` n'utilise de toute façon ni Tailwind ni
shadcn/ui, contrairement à l'hypothèse par défaut de plusieurs skills du
plugin.

## Critères d'acceptation
- [x] Une mission de suivi affiche un moyen visuel clair de se distinguer
      d'une première inspection, avec une référence de la réserve
      concernée (`MissionsListView.test.tsx`)
- [x] `completed` reflète l'état réel d'une mission de suivi fraîchement
      créée (`False` tant que l'inspecteur n'a rien soumis pour ELLE),
      sans régresser le cas déjà couvert (mission réellement faite reste
      `True`) — `apps/control/tests.py`, `test_vertical_slice_mvp1.py`
- [x] Le dropdown de preuves de BUILD différencie clairement des entrées
      du même jalon et du même jour (auteur + heure) — backend et
      frontend
- [x] Chaque correction a un test qui reproduisait le problème AVANT
      correction, vérifié rouge puis vert
- [x] Aucun composant créé hors de `packages/design-system` ; plugin
      UI/UX consulté et sa pertinence documentée
- [x] Suite complète backend (182 tests) et frontend (124 tests, 4
      workspaces) intégralement vertes

## Explicitement hors scope
- Afficher visuellement `completed` dans `MissionsListView` (la friction
  ne portait que sur la correction de sa DÉRIVATION, pas sur son affichage)
- "Type de preuve" (catégorie de `Document`) ou "extrait du contenu" dans
  le dropdown BUILD — l'auteur seul, combiné à l'heure, suffit à lever
  l'ambiguïté du rapport ; une Evidence peut porter plusieurs Document de
  catégories différentes, ce qui aurait demandé une jointure/agrégation
  supplémentaire hors scope de cette friction précise
- Renseigner enfin `Reserve.description` quelque part dans le code — un
  vrai contenu utile y changerait la référence affichée en `1`, mais
  aucun ticket ne le fait aujourd'hui

## Dépendances
Tickets 010 (CONTROL PWA), 012 (InspectionMission, missions), 013
(bugs bloquants + rapport bout-en-bout qui a révélé ces frictions), 009
(BUILD, contrainte de requêtes bornées toujours respectée).
