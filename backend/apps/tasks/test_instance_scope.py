"""PO-2026-09-30-12 — listes de tâches, cloche et Journal de l'administrateur
limités à l'instance active.

Chaque test échoue sans le correctif (constat du 30/09, PO-2026-09-30-11) :
les tâches antérieures aux instances ou d'une instance archivée remontaient
dans « À faire », la cloche, `/api/tasks/` et les boîtes administrateur et
contrôleur ; le Journal montrait les événements antérieurs à l'instance.
"""
import io
import uuid

import pytest
from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.core.demo import active_demo_instance
from apps.core.rls import set_rls_context
from apps.core.test_out_of_instance import PASSWORD, _seed_out_of_instance, seeded  # noqa: F401
from apps.organizations.models import Organization
from apps.programs.models import Lot, Program
from apps.sales.management.commands.seed_demo_scenario import KEYIMMO_ORG, PROMOTER_ORG
from apps.tasks.models import Task, TaskType

ADMIN = 'admin.demo@keya.test'
ADV = 'adv.demo@keya.test'
INSPECTEUR = 'inspecteur.demo@keya.test'
VIEW = 'HTTP_X_DEMO_INSTANCE_VIEW'


def _client(email):
    client = APIClient()
    token = client.post('/api/auth/login/', {'email': email, 'password': PASSWORD}, format='json').data['access']
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
    return client


def _task(program, email, label):
    lot_organization = program.organization_id
    set_rls_context(organization_id=lot_organization)
    lot = Lot.objects.filter(asset__program=program).first()
    keyimmo = Organization.objects.get(name=KEYIMMO_ORG)
    set_rls_context(organization_id=keyimmo.id)
    return Task.objects.create(
        organization=keyimmo, type=TaskType.TASK, subject_type=ContentType.objects.get_for_model(Lot),
        subject_id=lot.id, program=program, assignee=User.objects.get(email=email), source=f'test-{uuid.uuid4()}',
        label=label,
    )


def _ids(response):
    assert response.status_code == 200, response.content
    return {row['id'] for row in response.json()}


def _active_program():
    promoter = Organization.objects.get(name=PROMOTER_ORG)
    set_rls_context(organization_id=promoter.id)
    return Program.objects.get(organization=promoter, demo_instance=active_demo_instance())


@pytest.mark.django_db
def test_task_lists_and_bell_show_only_tasks_of_the_active_instance(seeded):  # noqa: F811
    legacy_program = _seed_out_of_instance()['program']
    active_program = _active_program()
    legacy = {email: str(_task(legacy_program, email, 'ancienne').id) for email in (ADMIN, ADV, INSPECTEUR)}
    current = {email: str(_task(active_program, email, 'de l’instance').id) for email in (ADMIN, ADV, INSPECTEUR)}

    adv = _client(ADV)
    for route in ('/api/me/tasks/', '/api/me/tasks/?status=pending', '/api/me/tasks/inbox/',
                  '/api/me/tasks/inbox/?status=pending', '/api/tasks/'):
        listed = _ids(adv.get(route))
        assert current[ADV] in listed, route
        assert legacy[ADV] not in listed, route
    assert adv.get(f'/api/tasks/{legacy[ADV]}/').status_code == 404
    assert adv.get(f'/api/tasks/{current[ADV]}/').status_code == 200

    admin_inbox = _ids(_client(ADMIN).get('/api/tasks/admin-inbox/'))
    assert current[ADMIN] in admin_inbox and legacy[ADMIN] not in admin_inbox
    inspector_inbox = _ids(_client(INSPECTEUR).get('/api/tasks/inspector-inbox/'))
    assert current[INSPECTEUR] in inspector_inbox and legacy[INSPECTEUR] not in inspector_inbox


@pytest.mark.django_db
def test_tasks_of_an_archived_instance_leave_the_inbox_and_the_bell(seeded):  # noqa: F811
    played = str(_task(_active_program(), ADV, 'de l’instance jouée').id)
    call_command('archive_demo_instance', '--confirm', '--reseed', stdout=io.StringIO())
    adv = _client(ADV)
    for route in ('/api/me/tasks/inbox/', '/api/me/tasks/inbox/?status=pending', '/api/me/tasks/', '/api/tasks/'):
        assert played not in _ids(adv.get(route)), route
    set_rls_context(organization_id=Organization.objects.get(name=KEYIMMO_ORG).id)
    assert Task.objects.filter(id=played).exists()  # conservée avec l'archive


@pytest.mark.django_db
def test_the_admin_journal_shows_the_active_instance_period_and_archives_stay_readable(seeded):  # noqa: F811
    _seed_out_of_instance()  # un événement antérieur à l'instance active
    promoter = Organization.objects.get(name=PROMOTER_ORG)
    set_rls_context(organization_id=promoter.id)
    legacy_ids = {str(pk) for pk in AuditEvent.objects.values_list('object_id', flat=True)}
    recent = AuditEvent.objects.create(
        organization=promoter, actor=None, action='reservation.created', object_type='sales.reservation',
        object_id=uuid.uuid4(), payload={},
    )
    instance = active_demo_instance()

    rows = _client(ADMIN).get('/api/admin/journal/').json()
    shown = {row['object_id'] for row in rows}
    assert str(recent.object_id) in shown
    assert not (legacy_ids & shown)

    call_command('archive_demo_instance', '--confirm', '--reseed', stdout=io.StringIO())
    admin = _client(ADMIN)
    assert str(recent.object_id) not in {row['object_id'] for row in admin.get('/api/admin/journal/').json()}
    archived = admin.get('/api/admin/journal/', **{VIEW: instance.code})
    assert archived.status_code == 200
    archived_ids = {row['object_id'] for row in archived.json()}
    assert str(recent.object_id) in archived_ids  # lecture seule, par le mode archive
    assert not (legacy_ids & archived_ids)
