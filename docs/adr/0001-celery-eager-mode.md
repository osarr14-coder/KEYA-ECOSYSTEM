# ADR 0001 — Celery en mode eager (pas de broker Redis provisionné)

## Statut

**Résolu le 2026-08-15.** Un broker Redis réel est provisionné (conteneur Docker), le
mode eager n'est plus la valeur par défaut de l'environnement de dev/prod, et le
comportement réel de retry/échec est désormais testé contre un vrai worker. Voir
« Résolution » ci-dessous. Conservé pour mémoire — le contexte explique des choix encore
présents dans le code (`transaction.atomic()` dans les tâches, propagation explicite de
`organization_id`).

## Contexte

Le ticket 004 (travaux/preuves/GED) exige un traitement asynchrone via une queue pour la
compression d'image et la génération de miniature. Au moment d'écrire ce ticket,
l'environnement de développement n'avait pas de broker Redis disponible : Docker Desktop
nécessitait WSL2, absent sur cette machine (voir l'historique du ticket 001 — la base
PostgreSQL elle-même a dû être installée nativement pour la même raison).

## Décision initiale

Celery intégré comme il le serait en production (`config/celery.py`, tâches déclarées
avec `@shared_task`, déclenchées via `.delay()`), mais `CELERY_TASK_ALWAYS_EAGER=True`
par défaut. Chaque tâche s'exécutait en synchrone, dans le même process et la même
transaction que la requête qui la déclenche, sans jamais transiter par un vrai broker.

## Résolution (2026-08-15)

WSL2 installé et Docker Desktop fonctionnel. Broker lancé avec la commande de référence
du projet :

```
docker run -d --name keyimmo-redis -p 6379:6379 redis:7-alpine
```

**Checklist traitée** :

1. **Broker Redis réel** — conteneur `keyimmo-redis` ci-dessus. `CELERY_BROKER_URL` et
   `CELERY_RESULT_BACKEND` pointent dessus (`config/settings.py`).
2. **`CELERY_TASK_ALWAYS_EAGER=False` par défaut** — dans `config/settings.py`. La
   majorité des tests (rapides) le repassent à `True` dans `config/settings_test.py` :
   exécution synchrone, dans la transaction du test, ce qui reste le comportement voulu
   pour ces tests-là (voir CLAUDE.md, section GED/Document). Seuls les tests
   d'intégration dédiés à un vrai worker le désactivent explicitement.
3. **Contexte RLS pour un worker distant** — résolu par propagation EXPLICITE :
   `organization_id` (et `requested_by_user_id` si connu) sont désormais des arguments
   de la tâche (`apps/evidence/tasks.py::process_document_media`), transmis par
   l'appelant (`apps/evidence/services.py::create_document`) et posés en tout début
   d'exécution via `apps.core.rls.set_rls_context`, à l'intérieur d'un
   `transaction.atomic()` englobant tout le corps de la tâche. Testé par
   `apps/evidence/test_celery_integration.py::test_task_sets_rls_context_from_explicit_arguments`
   (contexte effectivement posé, vérifié en SQL brut) et par
   `TestRealCeleryWorker::test_worker_processes_the_task_and_propagates_rls_context`
   (bout en bout, contre un vrai worker).
4. **Tests d'intégration contre un vrai worker** —
   `apps/evidence/test_celery_integration.py::TestRealCeleryWorker` : un vrai worker
   Celery (sous-processus `--pool=solo`, requis sous Windows — pas de `fork()`) contre le
   vrai broker. Deux scénarios : succès bout en bout (RLS + traitement réel), et retry
   réel avec backoff (1s/2s/4s) suivi d'un échec définitif sur un document qui n'existera
   jamais — assertion sur le temps écoulé pour prouver que les tentatives ont réellement
   eu lieu, pas juste un échec immédiat.

**Trois bugs réels trouvés en écrivant ces tests, tous corrigés** — utile pour quiconque
retouchera ce code :

- `apps/evidence/tasks.py` posait le contexte RLS puis lisait/écrivait le `Document` en
  dehors de toute transaction explicite. Un worker Celery tourne en autocommit par
  défaut ; `set_rls_context` (qui utilise `SET LOCAL`) n'a d'effet que pour la
  transaction en cours — sans `transaction.atomic()` englobant, le contexte retombait
  avant même la requête suivante (« syntaxe en entrée invalide pour le type uuid »).
  Corrigé en enveloppant tout le corps de la tâche.
- `config/settings_test.py` forçait `CELERY_TASK_ALWAYS_EAGER` (et `MEDIA_ROOT`) via
  `decouple.config(...)`, qui lit aussi `.env` — qui contient désormais
  `CELERY_TASK_ALWAYS_EAGER=False` pour l'environnement de dev réel. Résultat : toute la
  suite de tests rapide basculait silencieusement en mode non-eager par accident. Corrigé
  en lisant `os.environ` directement (pas `.env`) pour ces deux réglages spécifiques aux
  tests — `.env` ne doit influencer que `config/settings.py`, jamais les surcharges de
  `settings_test.py`.
- Le worker (sous-processus) et le process de test important chacun
  `config.settings_test` indépendamment, `MEDIA_ROOT` généré aléatoirement côté worker
  ne contenait pas les fichiers réellement écrits par le process de test
  (`FileNotFoundError`). Corrigé en transmettant `MEDIA_ROOT` du process de test au
  worker via une variable d'environnement explicite.

**Limite connue restante** : `real_celery_worker` (fixture de test) réinitialise
`celery_app._backend_cache`/`celery_app._local.backend` entre chaque test pour éviter
qu'un `ResultConsumer` Redis mis en cache par un test précédent ne bloque indéfiniment
le suivant — un détail d'implémentation interne de Celery, pas documenté publiquement,
à surveiller lors d'une montée de version de Celery.

## Pour les tickets 006 et 010

La question initiale de ce ticket (« ne pas attaquer 006/010 sans vrai comportement de
queue ») est levée : un vrai broker tourne, le retry/backoff est prouvé contre un vrai
worker. Reste spécifique à chacun, non couvert ici :

- **Ticket 006 (Task Inbox)** : la génération d'une `Task` depuis un `TrustEvent` peut
  s'appuyer sur ce même pattern (propagation explicite `organization_id`/`user_id`,
  `transaction.atomic()` dans la tâche) — l'idempotence de CETTE tâche spécifique reste à
  concevoir et tester le moment venu.
- **Ticket 010 (CONTROL mobile offline)** : la file média côté client (compression avant
  upload, retry avec backoff) est un mécanisme différent (côté navigateur/PWA, pas
  Celery) — ce ticket ne fournit qu'un exemple de test d'intégration contre un vrai
  worker côté serveur, pas la solution pour la file client.
