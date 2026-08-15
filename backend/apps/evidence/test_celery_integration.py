"""Tests d'intégration Celery contre un vrai broker Redis — voir
docs/adr/0001-celery-eager-mode.md.

Volontairement séparés de apps/evidence/tests.py : la majorité de la suite
(rapide) exécute les tâches en mode eager, synchrone, dans la transaction du
test (voir config/settings_test.py). Ce fichier fait l'inverse — un vrai
worker Celery, dans un sous-processus, contre le vrai broker Redis — pour
prouver deux choses que le mode eager ne peut structurellement pas prouver :
la propagation explicite du contexte RLS jusqu'à un worker distant, et un
vrai comportement de retry/échec.
"""

import io
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import pytest
import redis as redis_client_lib
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, transaction
from django.test import override_settings
from PIL import Image

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Organization
from config.celery import app as celery_app

from .models import Document
from .tasks import process_document_media

WORKER_STARTUP_TIMEOUT_SECONDS = 30
TASK_RESULT_TIMEOUT_SECONDS = 30


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


def _get_or_create_senegal_country_pack():
    # get_or_create, jamais un simple .get() : ce fichier mélange tests
    # `db` et `transactional_db` dans la même session pytest — un test
    # `transactional_db` antérieur peut avoir TRUNCATE la table et effacé
    # la donnée seedée par la migration (même piège que la fixture
    # `two_orgs` du ticket 001, voir CLAUDE.md).
    country_pack, _ = CountryPack.objects.get_or_create(code='SN', defaults={'label': 'Sénégal'})
    return country_pack


def _make_document(organization, owner, category='photo_test'):
    buffer = io.BytesIO()
    Image.new('RGB', (12, 12), (10, 20, 30)).save(buffer, format='JPEG')
    buffer.seek(0)
    uploaded_file = SimpleUploadedFile('photo.jpg', buffer.read(), content_type='image/jpeg')

    return Document.objects.create(
        organization=organization, owner=owner, category=category, source='mobile_app_photo',
        hash='0' * 64, file=uploaded_file,
    )


@pytest.mark.django_db
def test_task_sets_rls_context_from_explicit_arguments():
    """Ticket Celery (ADR 0001), point 3 : `organization_id`/
    `requested_by_user_id` doivent réellement se propager jusqu'à la tâche
    et y poser le contexte RLS — la seule chose qui permet à un worker sans
    requête HTTP de lire/écrire une ligne protégée par RLS.

    Appel direct de la fonction (pas `.delay()`) : exécution synchrone dans
    ce process, sans passer par le broker — suffisant pour prouver que la
    tâche pose bien le contexte reçu en argument, sans dépendre d'un vrai
    worker (testé séparément ci-dessous, TestRealCeleryWorker).
    """
    senegal = _get_or_create_senegal_country_pack()
    organization = Organization.objects.create(name='Org RLS Propagation', country_pack=senegal)
    user = User.objects.create_user(email='rls-propagation@example.com', password='pass12345')

    set_rls_context(organization_id=organization.id)
    document = _make_document(organization, user)

    process_document_media(
        document_id=str(document.id),
        organization_id=str(organization.id),
        requested_by_user_id=str(user.id),
    )

    with connection.cursor() as cursor:
        cursor.execute("SELECT current_setting('app.current_organization_id', true)")
        current_org = cursor.fetchone()[0]
        cursor.execute("SELECT current_setting('app.current_user_id', true)")
        current_user = cursor.fetchone()[0]

    assert current_org == str(organization.id)
    assert current_user == str(user.id)

    # Preuve fonctionnelle en plus de la preuve directe sur le contexte : le
    # traitement a bien pu lire/écrire le Document sous ce contexte.
    document.refresh_from_db()
    assert document.thumbnail.name


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
    Redis réel. `--pool=solo` : Celery ne supporte pas le pool `prefork`
    (basé sur `fork()`) sous Windows.

    `transactional_db`, pas `db` : les lignes créées par le test doivent
    être réellement committées pour qu'une connexion strictement séparée
    (le worker, dans un autre process) puisse les voir — même piège que
    documenté dans CLAUDE.md pour les tests RLS multi-connexions.

    Le nom de la base de test est généré dynamiquement par pytest-django ;
    transmis explicitement au sous-processus via `DB_NAME` plutôt que
    supposé, pour qu'il se connecte à la même base que ce process de test.
    """
    # `celery_app.conf.task_always_eager = False` NE TIENT PAS : Celery relit
    # dynamiquement `django.conf.settings.CELERY_TASK_ALWAYS_EAGER` à chaque
    # accès à `app.conf` (config_from_object('django.conf:settings', ...)),
    # donc une simple assignation directe est aussitôt masquée. Seul le vrai
    # mécanisme de surcharge Django (`override_settings`) fonctionne, vérifié
    # empiriquement.
    settings_override = override_settings(CELERY_TASK_ALWAYS_EAGER=False)
    settings_override.enable()

    # `celery_app` (le module `config.celery`) est un singleton réutilisé
    # pour toute la session pytest. Son `ResultConsumer` (créé une seule
    # fois dans `RedisBackend.__init__`, voir `celery.backends.redis`)
    # garde un état interne (`subscribed_to`, `drainer`, `_pending_results`)
    # qui reste lié à la connexion/au worker du PREMIER test à l'avoir
    # utilisé. Un `AsyncResult.get()` dans un test suivant, avec un worker
    # différent, reste alors bloqué indéfiniment dessus (timeout observé en
    # écrivant ces tests : chaque test passe seul, mais un 2e test échoue
    # systématiquement après un 1er qui a déjà utilisé le résultat
    # backend). Réinitialiser `_backend` à None force Celery à reconstruire
    # un `RedisBackend` (et donc un `ResultConsumer`) entièrement neuf au
    # prochain accès — un simple reset de la connexion Redis mise en cache
    # sur l'ancien backend (`backend.client`) ne suffit pas : testé, ça ne
    # corrige pas le blocage. `celery_app._backend` est elle-même une
    # property (setter qui exige un objet backend valide, pas None) — le
    # stockage réel est `celery_app._local.backend` (backend non thread-safe,
    # voir `Celery._backend.fget`/`.fset` dans celery/app/base.py) ou
    # `_backend_cache` pour un backend thread-safe ; on réinitialise les deux
    # pour couvrir les deux cas sans dépendre de lequel est utilisé.
    celery_app._backend_cache = None
    celery_app._local.backend = None

    test_db_name = connection.settings_dict['NAME']

    env = os.environ.copy()
    env['DJANGO_SETTINGS_MODULE'] = 'config.settings_test'
    env['DB_NAME'] = test_db_name
    # Indispensable : `override_settings` ci-dessus ne vaut que pour CE
    # process. Le worker importe config.settings_test de façon
    # indépendante — sans ça, son propre `self.retry()` (autoretry)
    # s'exécute en synchrone au lieu de re-publier sur le broker avec un
    # délai (voir le commentaire détaillé dans settings_test.py).
    env['CELERY_TASK_ALWAYS_EAGER'] = 'False'
    # Même MEDIA_ROOT que ce process : sinon settings_test.py en génère un
    # nouveau, aléatoire, côté worker — qui ne contient pas les fichiers
    # réellement écrits par ce process de test (voir settings_test.py).
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
        # orphelin laissé derrière (voir l'incident des serveurs dupliqués
        # non arrêtés, plus tôt dans ce projet).
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        log_file.close()
        settings_override.disable()


@requires_real_redis
class TestRealCeleryWorker:
    """Tests d'intégration contre un vrai worker Celery + un vrai broker
    Redis. Volontairement plus lents (démarrage d'un sous-processus,
    attentes réseau réelles, retries avec backoff réel) — c'est le prix de
    tester un vrai comportement asynchrone plutôt que le mode eager.
    """

    def test_worker_processes_the_task_and_propagates_rls_context(self, real_celery_worker):
        senegal = _get_or_create_senegal_country_pack()

        # `transactional_db` (nécessaire pour que le worker, dans un autre
        # process, voie les lignes) ne wrappe rien dans une transaction —
        # `set_config(..., true)` (SET LOCAL) est donc sans effet une fois
        # l'appel qui l'a posé terminé, sauf à l'envelopper explicitement.
        with transaction.atomic():
            organization = Organization.objects.create(name='Org Real Worker Success', country_pack=senegal)
            user = User.objects.create_user(email='real-worker-success@example.com', password='pass12345')
            set_rls_context(organization_id=organization.id)
            document = _make_document(organization, user)

        async_result = process_document_media.delay(
            document_id=str(document.id),
            organization_id=str(organization.id),
            requested_by_user_id=str(user.id),
        )
        async_result.get(timeout=TASK_RESULT_TIMEOUT_SECONDS)

        # Nouvelle lecture depuis CE process : reposer le contexte RLS
        # (celui du worker, dans son propre process, ne nous concerne pas).
        with transaction.atomic():
            set_rls_context(organization_id=organization.id)
            document.refresh_from_db()
            assert document.thumbnail.name, (
                "Le worker réel devait pouvoir lire/écrire le Document via le contexte RLS "
                "qu'il pose lui-même à partir de organization_id — preuve bout en bout que "
                'la propagation explicite (ADR 0001) fonctionne avec un vrai worker distant.'
            )

    def test_worker_retries_then_fails_permanently_on_a_document_that_never_exists(self, real_celery_worker):
        senegal = _get_or_create_senegal_country_pack()
        organization = Organization.objects.create(name='Org Real Worker Failure', country_pack=senegal)
        never_existing_id = str(uuid.uuid4())

        started_at = time.monotonic()
        async_result = process_document_media.delay(
            document_id=never_existing_id,
            organization_id=str(organization.id),
        )
        async_result.get(timeout=TASK_RESULT_TIMEOUT_SECONDS, propagate=False)
        elapsed = time.monotonic() - started_at

        assert async_result.failed(), 'Un document qui n\'existera jamais doit finir par échouer définitivement.'
        assert 'DoesNotExist' in repr(async_result.result)
        # Avec MAX_RETRIES=3 et un backoff de 1s doublant à chaque tentative
        # (apps/evidence/tasks.py), le worker attend au moins 1+2+4 = 7s
        # avant l'échec définitif — la seule façon d'observer que des
        # tentatives ont réellement eu lieu, pas un échec immédiat après la
        # première lecture ratée.
        assert elapsed >= 5, (
            f'Échec en {elapsed:.1f}s — trop rapide pour avoir réellement retenté '
            '(voir MAX_RETRIES/RETRY_BACKOFF_SECONDS dans apps/evidence/tasks.py).'
        )
