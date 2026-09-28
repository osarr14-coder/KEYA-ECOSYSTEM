# Postgres est obligatoire en test dès qu'une policy RLS est en jeu (ticket 001) :
# SQLite ne supporte pas RLS, un test qui passerait dessus ne prouverait rien.
import os
import tempfile

from .settings import *  # noqa: F401,F403

# Déploiement (Render, voir DEPLOY_RENDER.md) — `SECURE_SSL_REDIRECT` vaut
# `not DEBUG` dans settings.py ; `DEBUG` vaut False par défaut
# (config(..., default=False)) si la variable d'environnement n'est pas
# posée, ce qui est le cas de tout run pytest qui ne la définit pas
# explicitement. Bug RÉEL rencontré en lançant la suite complète dans un
# environnement propre pour valider ce ticket : chaque requête du client de
# test (APIClient) recevait une redirection 301 au lieu d'une vraie réponse
# (HttpResponsePermanentRedirect, sans `.data`) — la notion même de
# "HTTP vs HTTPS" n'a aucun sens pour ce client, qui simule des appels en
# process, jamais une vraie connexion réseau. Forcé à False ici,
# explicitement, jamais dépendant de la variable DEBUG ambiante — même
# discipline que CELERY_TASK_ALWAYS_EAGER plus bas (override qui n'a de
# sens qu'au niveau de CE module, pas de .env).
SECURE_SSL_REDIRECT = False

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

# Tickets B-046/B-047 — les throttles `login` (5/min) et `register`
# (20/heure), voir REST_FRAMEWORK dans settings.py, sont des taux de
# PRODUCTION. La suite complète appelle `register` et `login` des centaines
# de fois (quasi chaque test qui a besoin d'un client authentifié) : au taux
# de production, elle atteindrait le seuil en quelques dizaines de tests et
# ferait échouer le RESTE de la suite avec des 429 sans aucun rapport avec
# le code réellement testé — même piège que
# SECURE_SSL_REDIRECT/CELERY_TASK_ALWAYS_EAGER ci-dessus. Désactivés
# (`None` = pas de limite, comportement DRF documenté) pour ce module. Les
# tests dédiés (apps/accounts/tests.py) les réactivent en patchant
# directement `ScopedRateThrottle.THROTTLE_RATES` — PAS via
# `override_settings`, sans effet sur cet attribut de classe figé à l'import
# de DRF (voir la docstring de TestLoginThrottling).
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    'DEFAULT_THROTTLE_RATES': {'login': None, 'register': None, 'public': None},
}

# Audit UI R1 (R01) : l'inscription reste la fabrique de comptes des tests
# unitaires. Fermée partout ailleurs (settings.py) ; un test vérifie la
# fermeture (apps/sales/test_audit_ui_r1.py).
PUBLIC_REGISTRATION_ENABLED = True
# Les tests existants des modules différés (R04) continuent d'exercer leur
# code ; le masquage est testé explicitement (test_audit_ui_r1.py).
KEYA_DEFERRED_MODULES_ENABLED = True
# Même principe pour la synchronisation hors ligne (PO-2026-09-28-30) : ses
# tests existants continuent d'exercer le code ; la coupure est testée
# explicitement (apps/sales/test_audit_ui_r1_step7.py).
KEYA_OFFLINE_SYNC_ENABLED = True
# PO-2026-09-28-38 : idem pour les chantiers publics ; la coupure est testée
# explicitement (apps/sales/test_audit_ui_r1_step8.py).
KEYA_PUBLIC_WORKSITES_ENABLED = True
