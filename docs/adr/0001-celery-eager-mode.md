# ADR 0001 — Celery en mode eager (pas de broker Redis provisionné)

## Statut

Accepté, temporaire. À revisiter explicitement avant de démarrer les tickets 006 et 010.

## Contexte

Le ticket 004 (travaux/preuves/GED) exige un traitement asynchrone via une queue pour la
compression d'image et la génération de miniature. L'environnement de développement de ce
projet n'a pas de broker Redis disponible : Docker Desktop nécessite WSL2, absent sur cette
machine (voir l'historique du ticket 001 — la base PostgreSQL elle-même a dû être installée
nativement pour la même raison).

## Décision

Celery est intégré comme il le serait en production (`config/celery.py`, tâches déclarées
avec `@shared_task`, déclenchées via `.delay()` — voir `apps/evidence/tasks.py`), mais
`CELERY_TASK_ALWAYS_EAGER=True` par défaut (`config/settings.py`). Chaque tâche s'exécute
donc en synchrone, dans le même process et la même transaction que la requête qui la
déclenche, sans jamais transiter par un vrai broker.

## Conséquences

**Ce qui est validé aujourd'hui** : le contenu métier des tâches (ex : la compression ne
touche jamais aux champs de provenance d'un `Document`, voir ticket 004) — les tests
unitaires/intégration passent en mode eager exactement comme ils passeraient avec un vrai
worker, puisque le CODE exécuté est identique.

**Ce qui N'EST PAS validé, et ne peut PAS l'être en mode eager** :
- Le comportement de **retry** en cas d'échec d'une tâche (aucune tentative n'est jamais
  vraiment différée ni relancée — un échec en mode eager remonte immédiatement l'exception
  dans la requête HTTP appelante, ce qui n'a rien à voir avec un vrai comportement de
  worker asynchrone).
- Le **backoff** (délai croissant entre tentatives) : concept qui n'existe simplement pas
  en exécution synchrone.
- L'**exécution concurrente** de plusieurs tâches, l'ordonnancement, les files
  d'attente qui débordent, la latence réseau vers le broker.
- La résolution du contexte RLS (organisation active) pour un vrai worker distant : en mode
  eager, la tâche hérite du contexte déjà posé par le middleware pour la requête HTTP en
  cours (voir CLAUDE.md, section GED/Document) — un vrai worker n'a par définition aucune
  requête HTTP pour poser ce contexte, et devra le résoudre autrement avant de lire/écrire
  une ligne protégée par RLS. Cette question n'a pas de réponse dans le code actuel.

## À traiter avant les tickets 006 et 010

Ces deux tickets dépendent d'un vrai comportement de file d'attente, pas seulement de
l'exécution du code métier :

- **Ticket 006 (Task Inbox)** : la génération automatique d'une `Task` depuis un
  `TrustEvent` (ex. réserve ouverte) devra probablement être asynchrone à terme ;
  idempotence et gestion d'échec/retry doivent être testées contre un vrai worker avant de
  considérer ce flux fiable.
- **Ticket 010 (CONTROL mobile offline)** : critère d'acceptation explicite sur une « file
  média : compression côté client avant mise en queue d'upload, retry avec backoff ». Le
  mode eager ne peut structurellement pas prouver ce critère — il n'y a pas de file, pas de
  délai, pas de tentative différée à observer.

Avant d'attaquer l'un ou l'autre :
1. Provisionner un vrai broker Redis (native Windows via un service compatible type
   Memurai, ou conteneur Docker une fois WSL2 disponible — décision à prendre le moment
   venu, pas anticipée ici).
2. Repasser `CELERY_TASK_ALWAYS_EAGER=False`.
3. Résoudre la question du contexte RLS pour un worker distant (voir ci-dessus).
4. Écrire des tests d'intégration qui font réellement tourner un worker (retry sur échec
   simulé, comportement sous charge concurrente minimale) — les tests actuels du ticket 004
   ne couvrent que le contenu des tâches, pas le comportement de la queue elle-même.
