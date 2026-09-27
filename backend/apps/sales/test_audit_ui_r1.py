"""Audit UI R1 — étape 1 (P0) : tests côté serveur.

Chaque classe cite le constat de l'audit et le test CDC R1 (T01–T20) lié.
"""
from apps.sales.services import DEMO_BANK_INSTRUCTIONS


class TestJ01NoEscrowWording:
    """J01 : aucun terme « séquestre » ; « compte du programme (simulé) »."""

    def test_bank_instructions_describe_a_simulated_programme_account(self):
        text = ' '.join(DEMO_BANK_INSTRUCTIONS.values()).lower()
        assert 'séquestre' not in text
        assert 'compte du programme (simulé)' in text
        assert 'fictive' in text


# ─── D01 / T13 / T14 (partiel) : instance de démonstration ─────────────────

import pytest  # noqa: E402
from django.core.management import call_command  # noqa: E402
from django.db import IntegrityError, transaction  # noqa: E402
from django.urls import reverse  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from apps.core.demo import active_demo_instance  # noqa: E402
from apps.core.models import DemoInstance, DemoInstanceStatus  # noqa: E402
from apps.core.rls import set_rls_context  # noqa: E402
from apps.organizations.models import Organization  # noqa: E402
from apps.programs.models import Asset, Lot, LotCommercialStatus, Program  # noqa: E402

from .management.commands.seed_demo_scenario import DATASET_VERSION, PROGRAM_NAME, PROMOTER_ORG  # noqa: E402

SEED_PASSWORD = 'Demo-Test-2026!'


def _seed():
    call_command('seed_demo_scenario', password=SEED_PASSWORD)


def _login(email):
    api = APIClient()
    token = api.post(reverse('login'), {'email': email, 'password': SEED_PASSWORD}, format='json').data['access']
    api.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
    return api


def _stray_program(name='Programme B-047'):
    """Objet créé HORS scénario (comme les données de test parasites de
    l'étape 0) : même organisation promoteur, aucune instance."""
    promoter = Organization.objects.get(name=PROMOTER_ORG)
    set_rls_context(organization_id=promoter.id)
    program = Program.objects.create(organization=promoter, name=name)
    asset = Asset.objects.create(organization=promoter, program=program, name='Bâtiment Z', location='Dakar')
    Lot.objects.create(
        organization=promoter, asset=asset, name='Lot Z1', sale_price='25000000.00',
        commercial_status=LotCommercialStatus.DISPONIBLE, assigned_organization=promoter,
    )
    return program


@pytest.mark.django_db
class TestD01DemoInstance:
    def test_seed_creates_one_active_instance_and_attaches_the_programme(self):
        _seed()
        instance = active_demo_instance()
        assert instance is not None
        assert instance.dataset_version == DATASET_VERSION
        assert instance.code.startswith('DEMO-CI-')
        promoter = Organization.objects.get(name=PROMOTER_ORG)
        set_rls_context(organization_id=promoter.id)
        assert Program.objects.get(organization=promoter, name=PROGRAM_NAME).demo_instance == instance

    def test_reseeding_keeps_the_same_instance_and_programme(self):
        _seed()
        _seed()
        assert DemoInstance.objects.filter(status=DemoInstanceStatus.ACTIVE).count() == 1
        promoter = Organization.objects.get(name=PROMOTER_ORG)
        set_rls_context(organization_id=promoter.id)
        assert Program.objects.filter(organization=promoter, name=PROGRAM_NAME).count() == 1

    def test_a_single_active_instance_is_enforced_by_the_database(self):
        DemoInstance.objects.create(code='DEMO-A', dataset_version=DATASET_VERSION)
        with pytest.raises(IntegrityError), transaction.atomic():
            DemoInstance.objects.create(code='DEMO-B', dataset_version=DATASET_VERSION)

    def test_objects_created_outside_the_scenario_are_not_listed_publicly(self):
        _seed()
        _stray_program()
        names = [program['name'] for program in APIClient().get(reverse('public-offer')).json()]
        assert names == [PROGRAM_NAME]

    def test_objects_created_outside_the_scenario_are_not_in_the_client_catalogue(self):
        _seed()
        _stray_program()
        api = _login('client1.demo@keya.test')
        lots = api.get(reverse('catalog-lot-list')).json()
        assert {lot['name'] for lot in lots} == {'Lot A1', 'Lot A2'}

    def test_archived_instance_programmes_are_no_longer_listed(self):
        _seed()
        old = active_demo_instance()
        old.status = DemoInstanceStatus.ARCHIVED
        old.save(update_fields=['status'])
        DemoInstance.objects.create(code='DEMO-CI-NEXT', dataset_version=DATASET_VERSION, origin=old)
        assert APIClient().get(reverse('public-offer')).json() == []

    def test_t13_every_api_response_carries_environment_and_instance(self):
        _seed()
        response = APIClient().get(reverse('public-offer'))
        assert response['X-Environment'] == 'DEMO'
        assert response['X-Demo-Instance'] == active_demo_instance().code

    def test_public_endpoint_exposes_the_active_instance_without_account(self):
        _seed()
        payload = APIClient().get(reverse('public-demo-instance')).json()['instance']
        assert payload['code'] == active_demo_instance().code
        assert payload['environment'] == 'DEMO'
        assert payload['dataset_version'] == DATASET_VERSION

    def test_public_endpoint_returns_null_outside_a_demonstration(self):
        assert APIClient().get(reverse('public-demo-instance')).json() == {'instance': None}


# ─── D02 / T01 : disponibilité dérivée de la réservation active ────────────

@pytest.mark.django_db
class TestD02ReservedLotIsNeverOffered:
    def test_a_reserved_lot_leaves_the_public_offer_and_the_client_catalogue(self):
        _seed()
        client1 = _login('client1.demo@keya.test')
        catalogue = client1.get(reverse('catalog-lot-list')).json()
        lot_a2 = next(lot for lot in catalogue if lot['name'] == 'Lot A2')
        promoter = Organization.objects.get(name=PROMOTER_ORG)
        response = client1.post(
            reverse('reservation-create'), {'lot': lot_a2['id'], 'organization': str(promoter.id)}, format='json',
        )
        assert response.status_code == 201, response.data

        offer = APIClient().get(reverse('public-offer')).json()
        assert [lot['name'] for lot in offer[0]['lots']] == ['Lot A1']
        assert offer[0]['available_lots'] == 1
        client2 = _login('client2.demo@keya.test')
        assert [lot['name'] for lot in client2.get(reverse('catalog-lot-list')).json()] == ['Lot A1']


@pytest.mark.django_db
class TestT14NewInstanceAfterArchive:
    """T14 (partiel) : nouvelle instance indépendante, anciennes données non
    listées. Archive consultable dans l'application : NON implémentée."""

    def test_archive_then_reseed_creates_an_independent_instance(self, monkeypatch):
        monkeypatch.setenv('DEMO_PASSWORD', SEED_PASSWORD)
        _seed()
        first = active_demo_instance()
        _stray_program('Programme créé pendant la démo')
        call_command('archive_demo_instance', confirm=True, reseed=True)
        second = active_demo_instance()
        assert second.code != first.code
        assert second.origin == first
        first.refresh_from_db()
        assert first.status == DemoInstanceStatus.ARCHIVED and first.archived_at is not None
        offer = APIClient().get(reverse('public-offer')).json()
        assert [program['name'] for program in offer] == [PROGRAM_NAME]
        promoter = Organization.objects.get(name=PROMOTER_ORG)
        set_rls_context(organization_id=promoter.id)
        new_program = Program.objects.get(name=PROGRAM_NAME, demo_instance=second)
        assert offer[0]['id'] == str(new_program.id)
