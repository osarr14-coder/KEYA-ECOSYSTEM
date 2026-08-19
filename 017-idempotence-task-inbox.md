# Ticket 017 — Idempotence de la génération de Task (Task Inbox)

## Statut
Livré. Aucune nouvelle fonctionnalité — durcissement d'un mécanisme existant (ticket
006/012) contre la duplication.

## Objectif
Garantir qu'une même Task (réserve ouverte, mission affectée) n'est jamais créée en
double dans l'inbox d'un utilisateur, quelle que soit la raison d'une seconde exécution
du générateur — redélivrance broker, nouvelle tentative manuelle, ou double appel de
`.delay()` côté application. Referme le point explicitement laissé ouvert par
`docs/adr/0001-celery-eager-mode.md` (« l'idempotence de CETTE tâche spécifique reste à
concevoir et tester le moment venu ») au moment où le ticket 006 n'était pas encore
écrit.

## Contexte
`apps.tasks.services.create_task_for_reserve_opened` et
`create_task_for_mission_assigned` (ticket 006, étendu au ticket 012) appellent toutes
les deux `Task.objects.create(...)` sans aucune protection : ni contrainte d'unicité en
base, ni `get_or_create`, ni vérification préalable qu'une Task équivalente existe déjà.
Le modèle `Task` (`apps/tasks/models.py`) n'a aucune contrainte sur
`(subject_type, subject_id, source)`.

Les deux tâches Celery qui les appellent (`apps/tasks/tasks.py::process_reserve_opened`,
`process_mission_assigned`) tournent avec la configuration Celery par défaut de ce
projet — pas de `acks_late`, pas de `autoretry_for`, pas de logique de retry explicite
dans le corps de la tâche. Le risque de double exécution n'est donc pas la redélivrance
« worker tué en cours d'exécution » (peu probable avec cette configuration), mais reste
réel par d'autres chemins déjà observés ailleurs dans ce projet :
- reconnexion broker qui redélivre un message déjà traité (comportement Redis observé,
  pas seulement théorique),
- une future tentative manuelle de rejouer une tâche en échec (outil d'admin Celery,
  Flower, ou script) sans qu'on puisse garantir que l'appelant sait qu'elle a déjà
  réussi,
- un double appel de `.delay()` côté application si `_open_new_reserve`/`create_mission`
  était un jour appelé deux fois pour le même objet (ex. re-soumission réseau côté
  client) — hors scope de CE ticket de garantir l'idempotence de ces appelants, mais la
  génération de Task ne doit pas amplifier le problème si ça arrive.

Dans les trois cas, le symptôme est identique et visible par l'utilisateur final : la
même Task apparaît deux fois dans son inbox (`GET /api/me/tasks/`), sans qu'aucun signal
ne distingue "vraiment deux réserves différentes" de "la même réserve traitée deux
fois".

## Entités touchées
- `Task` (`apps.tasks.models`)
- `apps.tasks.services.create_task_for_reserve_opened`
- `apps.tasks.services.create_task_for_mission_assigned`
- `apps.tasks.tasks.process_reserve_opened` / `process_mission_assigned`

## Scope inclus
- Contrainte d'unicité en base sur `Task` portant sur `(subject_type, subject_id,
  source)` — une seule Task par couple (sujet métier précis, raison de génération) peut
  exister, quel que soit le nombre d'exécutions du générateur.
- `create_task_for_reserve_opened`/`create_task_for_mission_assigned` réécrits pour
  gérer explicitement la course sous la contrainte d'unicité ci-dessus — **`get_or_create`
  seul ne suffit pas sous vraie concurrence** : deux transactions peuvent toutes deux lire
  « n'existe pas » avant qu'aucune n'ait écrit ; la contrainte d'unicité empêche alors le
  doublon en base, mais fait échouer la SECONDE écriture avec une `IntegrityError` si
  elle n'est pas explicitement rattrapée. Correction : un `get()` initial, puis un
  `create()` sous `transaction.atomic()`, puis — SEULEMENT si `create()` lève
  `IntegrityError` — un second `get()` (jamais un retry aveugle de la création) pour
  récupérer la ligne existante créée entre-temps par l'autre transaction gagnante.
- Test qui appelle deux fois le même service pour la même `Reserve`/`InspectionMission`
  (pas seulement `.delay()` deux fois — la garantie doit tenir au niveau service, pas
  seulement au niveau tâche) et vérifie qu'une seule `Task` existe en base à l'issue des
  deux appels.
- Test qui force le VRAI chevauchement décrit ci-dessus — deux transactions réellement
  concurrentes (deux connexions distinctes, deux threads réels synchronisés par une
  barrière plutôt qu'un `sleep` hasardeux, même discipline que les tests de race du
  ticket 015) tentant de créer la même `Task` — et prouve qu'une seule `Task` existe au
  final, sans `IntegrityError` non rattrapée remontant à l'appelant.
- Test contre un vrai worker (`real_celery_worker`, pattern déjà établi par le ticket 004
  / `test_celery_integration.py`) : `process_reserve_opened.delay(...)` appelée deux
  fois avec les mêmes arguments — une seule Task en base, les deux appels réussissent
  (aucune exception remontée au worker sur le second appel).
- Documenter dans `docs/adr/0001-celery-eager-mode.md` (section « Pour les tickets 006 et
  010 ») que ce point est désormais résolu, avec un renvoi vers ce ticket — même
  discipline que la mise à jour faite pour la résolution initiale de cet ADR.

## Critères d'acceptation
- [x] Une contrainte d'unicité en base empêche deux `Task` avec le même
      `(subject_type, subject_id, source)` — `models.py::Meta.constraints`
      (`unique_task_per_subject_and_source`), migration `0003`. Vérifiée par les tests
      ci-dessous, qui provoquent réellement l'`IntegrityError` (pas une simple lecture du
      code) : trois fixtures de test existantes (`TestFourTaskTypesAreStructurallyDistinct`,
      `TestPriorityOrdering`) créaient plusieurs `Task` de test sur la même réserve avec le
      même `source='test_fixture'` — la contrainte les a fait échouer immédiatement,
      confirmant qu'elle est bien appliquée ; corrigées en variant `source` par tâche de
      test (ces `Task` synthétiques ne représentaient jamais le même événement rejoué)
- [x] Appeler `create_task_for_reserve_opened` deux fois pour la même `Reserve` ne crée
      qu'une seule `Task` — la seconde exécution ne lève aucune exception
      (`TestTaskGenerationIsIdempotent::test_calling_create_task_for_reserve_opened_twice_creates_only_one_task`)
- [x] Appeler `create_task_for_mission_assigned` deux fois pour la même
      `InspectionMission` ne crée qu'une seule `Task` — même garantie
      (`TestTaskGenerationIsIdempotent::test_calling_create_task_for_mission_assigned_twice_creates_only_one_task`)
- [x] Deux transactions RÉELLEMENT concurrentes (deux connexions, synchronisées par une
      barrière pour forcer le chevauchement exact, jamais un `sleep`) tentant de créer la
      même `Task` : une seule `Task` existe au final, aucune `IntegrityError` non
      rattrapée ne remonte à l'appelant dans l'un ou l'autre thread
      (`TestTaskCreationRaceUnderConcurrency`, `django_db(transaction=True)` + deux vrais
      threads/connexions) — confirmée stable sur 5 exécutions consécutives
- [x] `process_reserve_opened.delay(...)` appelée deux fois contre un vrai worker Celery
      (`real_celery_worker`) pour le même `reserve_id` : une seule `Task` en base au
      final, aucun échec de tâche observé sur le worker
      (`test_real_worker_processing_the_same_reserve_twice_never_duplicates_the_task`)
- [x] Le libellé et l'assignee de la Task existante ne sont jamais recalculés/écrasés
      par une seconde exécution — garanti PAR CONSTRUCTION dans `_get_or_create_task` :
      `defaults` (dont le libellé, calculé par l'appelant) n'est utilisé que par le
      `create()`, jamais appliqué à une ligne trouvée par l'un ou l'autre `get()` ; les
      deux tests d'idempotence ci-dessus vérifient déjà `first_task.id == second_task.id`
      (même ligne retournée, jamais une nouvelle)
- [x] Suite complète backend verte (186 tests — 182 + 4 nouveaux : 2 dans
      `TestTaskGenerationIsIdempotent`, 1 dans `TestTaskCreationRaceUnderConcurrency`, 1
      contre un vrai worker Celery), aucune régression sur les tickets 006/012

## Explicitement hors scope
- Garantir que `_open_new_reserve`/`create_mission` eux-mêmes ne sont jamais appelés
  deux fois pour le même événement métier (idempotence de la COUCHE APPELANTE) — ce
  ticket protège uniquement la génération de Task elle-même, en défense en profondeur,
  quelle que soit la fréquence réelle des doubles appels en amont
- Déduplication d'événements au niveau du broker (outbox pattern, clé d'idempotence
  Celery générique) — solution générique non nécessaire tant qu'une contrainte
  d'unicité ciblée suffit pour les deux seules tâches concernées
- Toute Task future qui ne suivrait pas encore ce même schéma générateur — à traiter au
  moment où un nouveau générateur est ajouté, en réutilisant la contrainte déjà posée
  ici (elle est générique à tout `(subject_type, subject_id, source)`, pas spécifique à
  la réserve ou à la mission)

## Dépendances
Ticket 006 (Task Inbox, modèle `Task`, `create_task_for_reserve_opened`), ticket 012
(`create_task_for_mission_assigned`), `docs/adr/0001-celery-eager-mode.md` (origine du
point resté ouvert).
