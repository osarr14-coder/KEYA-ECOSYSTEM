"""Tests d'intégration Celery contre un vrai broker Redis — voir
docs/adr/0001-celery-eager-mode.md.

Volontairement séparés de apps/evidence/tests.py : la majorité de la suite
(rapide) exécute les tâches en mode eager, synchrone, dans la transaction du
test (voir config/settings_test.py). Ce fichier fait l'inverse — un vrai
worker Celery, dans un sous-processus, contre le vrai broker Redis — pour
prouver deux choses que le mode eager ne peut structurellement pas prouver :
la propagation explicite du contexte RLS jusqu'à un worker distant, et un
vrai comportement de retry/échec. Fixture `real_celery_worker` et
utilitaires partagés dans conftest.py (racine du projet) — voir ce fichier
pour l'historique des bugs rencontrés en la mettant au point.
"""

import io
import time
import uuid

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, transaction
from PIL import Image

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import Organization
from conftest import TASK_RESULT_TIMEOUT_SECONDS, get_or_create_senegal_country_pack, requires_real_redis

from .models import Document
from .tasks import process_document_media


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
    senegal = get_or_create_senegal_country_pack()
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


@requires_real_redis
class TestRealCeleryWorker:
    """Tests d'intégration contre un vrai worker Celery + un vrai broker
    Redis. Volontairement plus lents (démarrage d'un sous-processus,
    attentes réseau réelles, retries avec backoff réel) — c'est le prix de
    tester un vrai comportement asynchrone plutôt que le mode eager.
    """

    def test_worker_processes_the_task_and_propagates_rls_context(self, real_celery_worker):
        senegal = get_or_create_senegal_country_pack()

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
        senegal = get_or_create_senegal_country_pack()
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
