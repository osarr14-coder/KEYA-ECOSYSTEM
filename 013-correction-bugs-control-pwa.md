# Ticket 013 — Correction des bugs bloquants du parcours CONTROL PWA

## Statut
Livré (commit `e6f1127`, puis complété par un correctif de tie-break de
`TrustEvent` trouvé lors d'un état des lieux du projet après une pause).
Documenté rétroactivement — ce fichier et la section CLAUDE.md
correspondante n'existaient pas au moment du commit initial, rupture
ponctuelle de la discipline documentaire suivie depuis le ticket 001.

## Objectif
Corriger les bugs bloquants du parcours CONTROL PWA (`apps/control-pwa` +
`apps/inspections`/`apps/control`) révélés par le test bout-en-bout du
vertical slice MVP 1 (doctrine V3.0 §22.4, voir ticket 012) et par un état
des lieux complet mené après une pause sur le projet. Aucune nouvelle
fonctionnalité — uniquement des corrections sur du code déjà livré aux
tickets 010 et 012.

## Bugs corrigés

### 1. Auto-soumission prématurée en "conforme"
`syncDraft` (`apps/control-pwa/src/sync/syncEngine.ts`) synchronisait un
brouillon sans décision explicite — `decision === null` tombait
silencieusement dans la branche « conforme » de `syncInspection`. Un
inspecteur qui cochait la checklist AVANT de choisir sa décision pouvait
ainsi déclencher une vraie certification « conforme » côté serveur, sans
intention. Corrigé : un brouillon sans décision reste en `pending`
indéfiniment, jamais synchronisé.

### 2. `knownLatestEventId` jamais rafraîchi après une synchronisation réussie
Le backend n'exposait `latest_event_id` sur aucune réponse "applied"
(`apps/inspections/services.py`, `apps/control/services.py`+`views.py`) —
`InspectionDraft.knownLatestEventId` restait figé à sa valeur d'origine
indéfiniment côté client, provoquant un conflit permanent (409) dès la
tentative suivante, même légitime. Corrigé : le backend expose désormais
`latest_event_id` sur toute réponse de succès ; le client met à jour
`InspectionDraft.knownLatestEventId` immédiatement après.

### 3. `reserve_id` jamais transmis lors d'une inspection de suivi
`list_missions_for_inspector` ne calculait ni `reserve_id` ni
`reserve_latest_event_id` par mission — un brouillon neuf sur une mission
de suivi n'avait aucun moyen légitime de savoir quelle réserve il
concernait, ni quel `known_latest_event_id` envoyer pour son premier essai.
Un inspecteur ne pouvait donc PAS lever une réserve via l'app réelle.
Corrigé : ces deux champs sont désormais calculés par mission ; un
brouillon neuf sur une mission de suivi amorce son `knownLatestEventId`
depuis `reserve_latest_event_id` et transmet `reserve` à la synchro.

### 4. Ordre non déterministe de `TrustEvent.get_current_status` (tie-break)
Trouvé en relançant la suite complète lors de l'état des lieux qui a suivi
la livraison des bugs 1 à 3 : le test introduit avec le bug 3
(`apps/control/tests.py::TestMissionListView::
test_mission_row_reserve_id_is_null_once_the_reserve_is_resolved`) était
committé rouge. `apps.trust.repository.get_current_status` triait
uniquement par `-created_at` — `_advance_existing_reserve`
(`apps/inspections/services.py`) crée coup sur coup deux `TrustEvent` sur
la même réserve dans la même transaction (`nouvelle_inspection` puis
`levee`/`rejetee`, sans commit intermédiaire), avec un `created_at` trop
proche pour être départagé de façon fiable — l'ordre pouvait renvoyer
`nouvelle_inspection` (toujours dans `OPEN_RESERVE_STATUSES`) au lieu de
l'événement terminal réel, laissant `list_missions_for_inspector` exposer
un `reserve_id` pour une réserve pourtant résolue.

Corrigé par un nouveau champ `TrustEvent.sequence` (migration
`apps/trust/migrations/0004_trustevent_sequence.py`) : entier alimenté à
l'insertion via `nextval()` sur une séquence Postgres dédiée
(`trust_event_sequence_seq`), posé aussi comme `DEFAULT` de la colonne
côté DB pour tout insert hors ORM — garantit un ordre d'insertion strict,
jamais recalculable après coup, même quand `created_at` ne suffit pas.
`get_current_status`/`list_for_subject` (`apps/trust/repository.py`)
trient désormais par `(-created_at, -sequence)`. N'affaiblit en rien
l'invariant append-only (ticket 003) : la colonne n'est jamais modifiée
après insertion, comme le reste du modèle ; ajouter la colonne a nécessité
de lever temporairement le trigger append-only et `FORCE ROW LEVEL
SECURITY` le temps de la migration (table vide en pratique dans cet
environnement), tous deux restaurés avant la fin de la transaction de
migration.

**Piège de migration rencontré** : `trust_event` porte le trigger
append-only (migration 0002) ET aucune policy RLS `UPDATE` — les deux
bloquent normalement tout `UPDATE`, y compris pour le rôle propriétaire de
la table (voir CLAUDE.md, section "Append-only"). Le backfill de
`sequence` sur des lignes existantes (`UPDATE trust_event SET sequence =
...`) aurait donc été silencieusement bloqué (RLS) ou aurait levé
l'exception du trigger, selon l'ordre des couches — les deux ont dû être
levées explicitement (`NO FORCE ROW LEVEL SECURITY` + `DISABLE TRIGGER`)
puis restaurées dans la même migration, jamais un affaiblissement
permanent.

**Limite connue, non corrigée par ce ticket** : le même défaut de tri
(`-created_at` seul, sans tie-break) existe aussi dans trois lectures
directes de `TrustEvent` qui ne passent pas par
`apps.trust.repository` — `apps/build/services.py::_bulk_open_reserves`
et `apps/home/services.py::compute_milestone_status`/
`get_latest_notable_event`. Même classe de bug, non exercée par un test
existant, laissée pour un futur ticket (nécessiterait de les faire
transiter par `apps.trust.repository` plutôt que de dupliquer le tri, ou
d'ajouter `-sequence` localement à chacune).

## Critères d'acceptation
- [x] Un brouillon sans décision n'est jamais synchronisé automatiquement
      (`apps/control-pwa/src/sync/syncEngine.test.ts`)
- [x] Une synchronisation réussie met à jour `knownLatestEventId` côté
      client, rendant possible une tentative suivante légitime sans
      conflit (`syncEngine.test.ts`, `apps/control/tests.py`)
- [x] Une mission de suivi transmet `reserve` à la synchronisation et
      amorce son `knownLatestEventId` depuis `reserve_latest_event_id`
      (`apps/control/tests.py::TestMissionListView`)
- [x] Une fois une réserve résolue (`levee`/`rejetee`), plus aucune ligne
      de la liste de missions ne la référence
      (`apps/control/tests.py::TestMissionListView::
      test_mission_row_reserve_id_is_null_once_the_reserve_is_resolved`)
- [x] Suite complète backend (176 tests) et frontend (119 tests, 4
      workspaces) intégralement vertes, pas seulement par lots

## Explicitement hors scope
- Le tri par tie-break des trois lectures directes de `TrustEvent`
  listées ci-dessus (« limite connue »)
- Fusion/arbitrage lors d'un conflit de synchronisation (ADR 0002,
  décision déjà actée au ticket 010 passe 2)

## Dépendances
Tickets 003 (TrustEvent append-only), 005 (cycle de vie Reserve), 010
(CONTROL PWA, passes 1 et 2), 012 (InspectionMission, `reserve_id`/
`reserve_latest_event_id`).
