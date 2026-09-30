"""PO-2026-09-30-11 (C7) — `check_out_of_instance` : inventaire des données
hors instance et vérification de leur visibilité par l'API.

La base de Render a servi avant les instances : on y reproduit des données
antérieures SANS instance (programme B-047 et ses lots A3/A4, flux financiers,
chantier, réserve, tâche, organisation en double, ancien compte), marquées
« HORSINST ».
"""
import io
import re
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.core.demo import active_demo_instance
from apps.core.models import DemoInstance, DemoInstanceStatus
from apps.core.management.commands import check_out_of_instance as command
from apps.core.rls import set_rls_context
from apps.evidence.models import WorkDeclaration
from apps.inspections.models import Inspection, Reserve
from apps.organizations.models import Organization
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot
from apps.sales.management.commands.seed_demo_scenario import KEYIMMO_ORG, PROMOTER_ORG
from apps.sales.models import CustomerReceipt, PaymentCall, PaymentCallKind, Reservation, ReservationStatus
from apps.tasks.models import Task, TaskStatus, TaskType

PASSWORD = 'mot-de-passe-de-test-123'
MARK = 'HORSINST'
OLD_ACCOUNT = f'acquereur.a@{MARK.lower()}.test'


class ApiClientHttp:
    """Remplace le client HTTP de la commande par le client de test DRF."""

    def __init__(self, base):
        self.client = APIClient()

    def login(self, email, password):
        response = self.client.post('/api/auth/login/', {'email': email, 'password': password}, format='json')
        return (response.data.get('access') if response.status_code == 200 else None), response.status_code

    def get(self, path, token=None):
        self.client.credentials(**({'HTTP_AUTHORIZATION': f'Bearer {token}'} if token else {}))
        response = self.client.get(path)
        return response.status_code, response.content.decode('utf-8', 'replace')


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(command.Command, 'http_class', ApiClientHttp)
    monkeypatch.setenv('DEMO_PASSWORD', PASSWORD)


def _run(*args):
    out = io.StringIO()
    try:
        call_command('check_out_of_instance', *args, '--pause', '0', stdout=out)
    except CommandError as exc:
        return out.getvalue(), str(exc)
    return out.getvalue(), None


def _gaps(output):
    return [line for line in output.splitlines() if line.startswith('ÉCART')]


def _seed_out_of_instance():
    promoter = Organization.objects.get(name=PROMOTER_ORG)
    set_rls_context(organization_id=promoter.id)
    program = Program.objects.create(organization=promoter, name=f'{MARK} Programme B-047', demo_instance=None)
    asset = Asset.objects.create(organization=promoter, program=program, name=f'{MARK} Bien Dakar')
    lots = []
    for name in ('A3', 'A4'):
        lot = Lot.objects.create(organization=promoter, asset=asset, name=f'{MARK} Lot {name}', sale_price=30000000)
        instantiate_milestones_for_lot(lot)
        lots.append(lot)
    client1 = User.objects.get(email='client1.demo@keya.test')
    adv = User.objects.get(email='adv.demo@keya.test')
    finance = User.objects.get(email='finance.demo@keya.test')
    constructeur = User.objects.get(email='constructeur.demo@keya.test')
    inspecteur = User.objects.get(email='inspecteur.demo@keya.test')
    reservation = Reservation.objects.create(
        organization=promoter, lot=lots[0], client=client1, status=ReservationStatus.RESERVED,
        held_until=timezone.now() + timedelta(days=3), price_amount=30000000,
    )
    PaymentCall.objects.create(
        organization=promoter, reservation=reservation, client=client1, kind=PaymentCallKind.FRAIS,
        amount=Decimal('500000'), issued_by=adv,
    )
    CustomerReceipt.objects.create(
        organization=promoter, reservation=reservation, client=client1, bank_reference=f'{MARK}-VIR-1',
        amount=Decimal('500000'), received_on=date(2026, 3, 1), recorded_by=finance,
    )
    declaration = WorkDeclaration.objects.create(
        organization=promoter, milestone=lots[0].milestones.first(), declared_by=constructeur, note=MARK,
    )
    inspection = Inspection.objects.create(
        organization=promoter, lot=lots[0], inspector=inspecteur, outcome='avec_reserve', work_declaration=declaration,
    )
    Reserve.objects.create(organization=promoter, lot=lots[0], opened_by_inspection=inspection)
    AuditEvent.objects.create(
        organization=promoter, actor=constructeur, action='reservation.created', object_type='sales.reservation',
        object_id=reservation.id, payload={'note': MARK},
    )
    # Le journal est en ajout seul : l'événement ancien ne peut pas être
    # antidaté, c'est l'instance active qui est postérieure.
    DemoInstance.objects.filter(status=DemoInstanceStatus.ACTIVE).update(created_at=timezone.now())
    keyimmo = Organization.objects.get(name=KEYIMMO_ORG)
    set_rls_context(organization_id=keyimmo.id)
    task = Task.objects.create(
        organization=keyimmo, type=TaskType.TASK, subject_type=ContentType.objects.get_for_model(Lot),
        subject_id=lots[0].id, program=program, assignee=adv, source='test', label=f'{MARK} tâche ancienne',
    )
    duplicate = Organization.objects.create(name=f'{MARK} KEYIMMO (doublon)', country_pack=promoter.country_pack)
    set_rls_context(organization_id=duplicate.id)
    Program.objects.create(organization=duplicate, name=f'{MARK} Chantier Almadies', demo_instance=None)
    User.objects.create_user(email=OLD_ACCOUNT, password=PASSWORD)
    return {'program': program, 'lots': lots, 'task': task, 'duplicate': duplicate}


@pytest.fixture
def seeded(db):
    call_command('seed_demo_scenario', password=PASSWORD, stdout=io.StringIO())


@pytest.mark.django_db
def test_a_freshly_reset_base_has_nothing_out_of_instance(seeded, api):
    output, error = _run('--api', 'http://test')
    assert error is None, output
    assert 'programmes            : 0' in output
    assert _gaps(output) == []
    assert 'Aucune donnée hors instance visible' in output


@pytest.mark.django_db
def test_the_inventory_lists_out_of_instance_data_and_writes_nothing(seeded):
    seeded_data = _seed_out_of_instance()
    counts = (Program.objects.count(), Task.objects.count(), User.objects.count())
    output, error = _run()
    assert error is None
    for text in (f'{MARK} Programme B-047', f'{MARK} Chantier Almadies', 'hors instance',
                 'lots                  : 2', 'réservation           : 1', 'appel de fonds        : 1',
                 'encaissement          : 1', 'déclaration de travaux: 1', 'réserve               : 1',
                 'tâches                : 1 dont 1 en attente', f'{MARK} KEYIMMO (doublon)', OLD_ACCOUNT):
        assert text in output, text
    assert re.search(r'journal\s+: [1-9]\d* événement', output)
    assert 'Visibilité non vérifiée' in output
    set_rls_context(organization_id=seeded_data['duplicate'].id)
    assert (Program.objects.count(), Task.objects.count(), User.objects.count()) == counts


@pytest.mark.django_db
def test_the_api_check_requires_the_demo_password(seeded, monkeypatch):
    monkeypatch.delenv('DEMO_PASSWORD', raising=False)
    _output, error = _run('--api', 'http://test')
    assert 'DEMO_PASSWORD absent' in error


@pytest.mark.django_db
def test_the_api_check_reports_what_the_filtering_lets_through(seeded, api):
    """Constat du 30/09 (PO-2026-09-30-11) : le filtrage par instance tient
    partout SAUF les listes de tâches et la vue active du journal. Ce test
    fixe ce constat ; il changera avec le correctif soumis au PO."""
    _seed_out_of_instance()
    output, error = _run('--api', 'http://test')
    assert error is not None and 'visibles' in error
    leaks = {(line.split()[1], line.split()[2]) for line in _gaps(output)}
    assert leaks == {
        ('admin.demo@keya.test', '/api/admin/journal/'),
        ('admin.demo@keya.test', '/api/tasks/'),
        ('adv.demo@keya.test', '/api/tasks/'),
        ('adv.demo@keya.test', '/api/me/tasks/'),
        ('adv.demo@keya.test', '/api/me/tasks/inbox/'),
        ('finance.demo@keya.test', '/api/tasks/'),
    }
    assert 'antérieur(s) à l’instance' in output


@pytest.mark.django_db
def test_pending_tasks_of_an_archived_instance_are_detected(seeded, api):
    """Après chaque réinitialisation (C7), les tâches en attente de l'instance
    archivée restent dans « À faire » (`/api/me/tasks/inbox/`)."""
    instance = active_demo_instance()
    program = Program.objects.get(demo_instance=instance)
    set_rls_context(organization_id=program.organization_id)
    lot = Lot.objects.filter(asset__program=program).first()
    keyimmo = Organization.objects.get(name=KEYIMMO_ORG)
    set_rls_context(organization_id=keyimmo.id)
    Task.objects.create(
        organization=keyimmo, type=TaskType.TASK, subject_type=ContentType.objects.get_for_model(Lot),
        subject_id=lot.id, program=program, assignee=User.objects.get(email='adv.demo@keya.test'),
        source='test', label='Tâche de l’instance jouée', status=TaskStatus.PENDING,
    )
    call_command('archive_demo_instance', '--confirm', '--reseed', stdout=io.StringIO())
    output, error = _run('--api', 'http://test')
    assert error is not None
    assert f'archive {instance.code}' in output
    gaps = _gaps(output)
    assert any('/api/me/tasks/inbox/' in line for line in gaps)
    assert not any(' /api/me/tasks/ ' in line for line in gaps)  # celle-ci exclut déjà les archives
