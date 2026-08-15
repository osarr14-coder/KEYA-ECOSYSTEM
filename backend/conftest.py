"""Fixtures et utilitaires de test partagés entre apps.

Centralisé ici (racine du projet, auto-découvert par pytest) plutôt que
dupliqué par app : plusieurs apps (evidence, tasks...) ont besoin d'un vrai
worker Celery contre un vrai broker Redis pour prouver un comportement
asynchrone que le mode eager ne peut structurellement pas prouver — voir
docs/adr/0001-celery-eager-mode.md. Introduit au ticket 004, réutilisé tel
quel au ticket 006 plutôt que redupliqué (instruction explicite : ne pas
réinventer un pattern déjà résolu).
"""

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest
import redis as redis_client_lib
from django.conf import settings
from django.db import connection
from django.test import override_settings

from apps.organizations.models import CountryPack
from config.celery import app as celery_app

WORKER_STARTUP_TIMEOUT_SECONDS = 30
TASK_RESULT_TIMEOUT_SECONDS = 30

# Doit correspondre exactement à
# apps/programs/migrations/0003_seed_senegal_milestone_template.py — dupliqué
# ici volontairement plutôt qu'importé (une migration est un enregistrement
# historique, pas un module à réutiliser, voir apps/programs/tests.py).
_SENEGAL_MILESTONE_STEPS = [
    ('foncier', 'Foncier'),
    ('conception', 'Conception'),
    ('fondations', 'Fondations'),
    ('gros_oeuvre', 'Gros œuvre'),
    ('second_oeuvre', 'Second œuvre'),
    ('finitions', 'Finitions'),
    ('reception', 'Réception'),
    ('livraison', 'Livraison'),
]


def get_or_create_senegal_country_pack():
    # get_or_create, jamais un simple .get() : un test `transactional_db`
    # antérieur dans la même session pytest peut avoir TRUNCATE la table et
    # effacé la donnée seedée par la migration (piège documenté au ticket
    # 001, voir CLAUDE.md section RLS multi-tenant).
    country_pack, _ = CountryPack.objects.get_or_create(code='SN', defaults={'label': 'Sénégal'})
    return country_pack


def ensure_senegal_milestone_template_seeded():
    """Même piège que `get_or_create_senegal_country_pack`, mais pour le
    template de jalons (ticket 002) : un test `transactional_db` qui
    TRUNCATE la base efface aussi cette donnée seedée par migration. Sans
    ce garde-fou, `apps.programs.services.instantiate_milestones_for_lot`
    ne crée silencieusement AUCUN jalon pour les tests qui en dépendent
    après un tel test dans la même session pytest (rencontré en écrivant
    les tests du ticket 006, qui enchaînent après
    apps/evidence/test_celery_integration.py).
    """
    from apps.programs.models import MilestoneTemplate, MilestoneTemplateStep

    country_pack = get_or_create_senegal_country_pack()
    template, created = MilestoneTemplate.objects.get_or_create(
        country_pack=country_pack, version=1, defaults={'is_active': True},
    )
    if not created and template.steps.exists():
        return template

    for order, (code, label) in enumerate(_SENEGAL_MILESTONE_STEPS, start=1):
        MilestoneTemplateStep.objects.get_or_create(
            template=template, order=order, defaults={'code': code, 'label': label},
        )
    return template


def _redis_is_available():
    try:
        client = redis_client_lib.Redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2)
        return bool(client.ping())
    except Exception:
        return False


requires_real_redis = pytest.mark.skipif(
    not _redis_is_available(),
    reason=(
        f'Broker Redis réel indisponible sur {settings.CELERY_BROKER_URL} — '
        'voir docs/adr/0001-celery-eager-mode.md ("docker run -d --name keyimmo-redis '
        '-p 6379:6379 redis:7-alpine").'
    ),
)


def _wait_for_worker_ready(process, log_path, timeout):
    deadline = time.monotonic() + timeout
    inspector = celery_app.control.inspect(timeout=1)
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = Path(log_path).read_text(encoding='utf-8', errors='replace')
            raise RuntimeError(f'Le worker Celery a quitté prématurément :\n{output}')
        try:
            pong = inspector.ping()
        except Exception:
            pong = None
        if pong:
            return
        time.sleep(0.5)
    process.terminate()
    raise TimeoutError(f"Le worker Celery n'a pas répondu à un ping dans les {timeout}s.")


@pytest.fixture
def real_celery_worker(transactional_db):
    """Démarre un vrai worker Celery (sous-processus) contre le broker
    Redis réel — voir docs/adr/0001-celery-eager-mode.md. `--pool=solo` :
    Celery ne supporte pas le pool `prefork` (basé sur `fork()`) sous
    Windows.

    `transactional_db`, pas `db` : les lignes créées par le test doivent
    être réellement committées pour qu'une connexion strictement séparée
    (le worker, dans un autre process) puisse les voir (CLAUDE.md, section
    RLS multi-tenant).
    """
    # `celery_app.conf.task_always_eager = False` NE TIENT PAS : Celery relit
    # dynamiquement `django.conf.settings.CELERY_TASK_ALWAYS_EAGER` à chaque
    # accès à `app.conf` (config_from_object('django.conf:settings', ...)),
    # donc une simple assignation directe est aussitôt masquée. Seul le vrai
    # mécanisme de surcharge Django (`override_settings`) fonctionne, vérifié
    # empiriquement en écrivant ces tests.
    settings_override = override_settings(CELERY_TASK_ALWAYS_EAGER=False)
    settings_override.enable()

    # `celery_app` (le module `config.celery`) est un singleton réutilisé
    # pour toute la session pytest. Son `ResultConsumer` (créé une seule
    # fois dans `RedisBackend.__init__`, voir `celery.backends.redis`)
    # garde un état interne qui reste lié à la connexion/au worker du
    # PREMIER test à l'avoir utilisé — un `AsyncResult.get()` dans un test
    # suivant, avec un worker différent, reste alors bloqué indéfiniment
    # dessus. Réinitialiser le backend force Celery à en reconstruire un
    # entièrement neuf au prochain accès. `celery_app._backend` est
    # elle-même une property (setter qui exige un objet backend valide, pas
    # None) — le stockage réel est `celery_app._local.backend` (backend non
    # thread-safe) ou `_backend_cache` (thread-safe) ; on réinitialise les
    # deux pour couvrir les deux cas sans dépendre de lequel est utilisé.
    celery_app._backend_cache = None
    celery_app._local.backend = None

    test_db_name = connection.settings_dict['NAME']

    env = os.environ.copy()
    env['DJANGO_SETTINGS_MODULE'] = 'config.settings_test'
    env['DB_NAME'] = test_db_name
    # Indispensable : `override_settings` ci-dessus ne vaut que pour CE
    # process. Le worker importe config.settings_test de façon
    # complètement indépendante et ne voit jamais cette surcharge en
    # mémoire — sans cette variable d'environnement, son propre
    # `self.retry()` (autoretry) s'exécute en synchrone au lieu de
    # re-publier sur le broker avec un délai (voir settings_test.py).
    env['CELERY_TASK_ALWAYS_EAGER'] = 'False'
    # Même MEDIA_ROOT que ce process, au cas où la tâche testée manipule
    # des fichiers : sinon settings_test.py en génère un nouveau, aléatoire,
    # côté worker, qui ne contiendrait pas les fichiers réellement écrits
    # par ce process de test.
    env['MEDIA_ROOT'] = str(settings.MEDIA_ROOT)

    log_file = tempfile.NamedTemporaryFile(
        mode='w', suffix='.log', prefix='keya_celery_worker_', delete=False,
    )
    process = subprocess.Popen(
        [
            sys.executable, '-m', 'celery', '-A', 'config', 'worker',
            '--pool=solo', '--loglevel=info',
            '--without-heartbeat', '--without-gossip', '--without-mingle',
        ],
        cwd=str(settings.BASE_DIR),
        env=env,
        # Fichier, pas PIPE : un PIPE jamais lu en continu peut bloquer le
        # process enfant une fois son tampon plein (piège classique de
        # subprocess). Chemin affiché pour diagnostic en cas d'échec.
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    print(f'\n[real_celery_worker] log : {log_file.name}')

    try:
        _wait_for_worker_ready(process, log_file.name, timeout=WORKER_STARTUP_TIMEOUT_SECONDS)
        yield process
    finally:
        # Nettoyage garanti, succès ou échec du test — jamais de worker
        # orphelin laissé derrière (incident déjà vécu sur ce projet).
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        log_file.close()
        settings_override.disable()
