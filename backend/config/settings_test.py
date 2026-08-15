# Postgres est obligatoire en test dès qu'une policy RLS est en jeu (ticket 001) :
# SQLite ne supporte pas RLS, un test qui passerait dessus ne prouverait rien.
import os
import tempfile

from .settings import *  # noqa: F401,F403

# Fichiers uploadés en test écrits dans un dossier temporaire système, hors
# du repo — jamais dans MEDIA_ROOT réel (ticket 004).
#
# Si MEDIA_ROOT est déjà présent dans l'environnement (le worker Celery réel
# lancé en sous-processus par apps/evidence/test_celery_integration.py le
# fait explicitement), on le réutilise tel quel plutôt que d'en générer un
# nouveau : un worker qui tourne dans son propre process, avec son propre
# import de ce module, obtiendrait sinon un dossier temporaire ALÉATOIRE
# DIFFÉRENT de celui du process de test qui a réellement écrit le fichier —
# bug réel rencontré en écrivant ces tests (FileNotFoundError côté worker).
MEDIA_ROOT = os.environ.get('MEDIA_ROOT') or tempfile.mkdtemp(prefix='keya_ecosystem_test_media_')

# La majorité des tests (ex. apps/evidence/tests.py) exécutent les tâches
# Celery en synchrone, dans la même transaction que le test : c'est rapide
# et ça évite le problème classique de ce projet (une connexion séparée ne
# voit pas les lignes non committées d'un test utilisant le fixture `db`,
# voir CLAUDE.md section RLS). Les tests d'intégration dédiés à un vrai
# worker (apps/evidence/test_celery_integration.py) repassent ce flag à
# False dans LEUR PROCESS via `override_settings` — mais le WORKER, lancé en
# sous-processus, importe ce module de façon complètement indépendante et ne
# voit jamais cette surcharge en mémoire ; il lui faut donc une vraie
# variable d'environnement (`env['CELERY_TASK_ALWAYS_EAGER'] = 'False'`,
# posée par ce fixture) plutôt qu'un override en mémoire.
#
# `os.environ.get(...)` directement, PAS `decouple.config(...)` : ce
# dernier lit aussi `.env`, qui contient `CELERY_TASK_ALWAYS_EAGER=False`
# pour l'environnement de dev réel (voir config/settings.py) — avec
# `config(...)`, CETTE valeur de `.env` désactivait le mode eager pour
# TOUTE la suite de tests par accident (régression réelle rencontrée :
# apps/evidence/tests.py, qui suppose un traitement synchrone, échouait).
# `.env` ne doit jamais influencer ce choix, qui n'a de sens qu'au niveau
# process (worker réel vs reste de la suite).
CELERY_TASK_ALWAYS_EAGER = os.environ.get('CELERY_TASK_ALWAYS_EAGER', 'True') == 'True'
