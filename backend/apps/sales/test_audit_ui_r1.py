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
from .testing import commit_lot  # noqa: E402

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


# ─── R01 : aucune inscription publique (CDC §10, PO-2026-09-27-08) ─────────

from django.test import override_settings  # noqa: E402

from apps.accounts.models import User  # noqa: E402


@pytest.mark.django_db
class TestR01NoPublicRegistration:
    def test_registration_is_closed_outside_the_test_factory(self):
        with override_settings(PUBLIC_REGISTRATION_ENABLED=False):
            response = APIClient().post(
                reverse('register'),
                {'email': 'visiteur@example.com', 'password': 'Visiteur-2026!', 'full_name': 'Visiteur', 'role': 'client'},
                format='json',
            )
        assert response.status_code == 404
        assert not User.objects.filter(email='visiteur@example.com').exists()

    def test_registration_is_closed_by_default_in_the_project_settings(self, monkeypatch):
        import importlib

        from config import settings as project_settings
        monkeypatch.delenv('PUBLIC_REGISTRATION_ENABLED', raising=False)
        assert importlib.reload(project_settings).PUBLIC_REGISTRATION_ENABLED is False

    def test_provisioned_demo_accounts_can_still_log_in(self):
        _seed()
        assert _login('client1.demo@keya.test') is not None


# ─── R02 : administrateur sans pouvoir métier (CDC §4, PO-2026-09-27-09) ───

ADMIN = 'admin.demo@keya.test'
ADV = 'adv.demo@keya.test'
FINANCE = 'finance.demo@keya.test'


def _promoter_lot():
    promoter = Organization.objects.get(name=PROMOTER_ORG)
    set_rls_context(organization_id=promoter.id)
    return promoter, Lot.objects.filter(organization=promoter).order_by('name').first()


@pytest.mark.django_db
class TestR02AdminHasNoBusinessPower:
    """Refus SERVEUR (403), pas seulement un menu masqué."""

    def test_admin_is_refused_every_business_read(self):
        _seed()
        admin = _login(ADMIN)
        for name in (
            'reservation-admin-list', 'finance-account-list', 'finance-payment-notice-list',
            'backoffice-control-list', 'backoffice-inspector-list', 'backoffice-litige-list',
        ):
            assert admin.get(reverse(name)).status_code == 403, name

    def test_admin_cannot_prepare_the_business_scenario(self):
        _seed()
        admin = _login(ADMIN)
        promoter, lot = _promoter_lot()
        created = admin.post(reverse('program-list'), {'organization': str(promoter.id), 'name': 'X'}, format='json')
        assert created.status_code == 403
        price = admin.patch(
            reverse('lot-detail', args=[lot.id]) + f'?organization_id={promoter.id}', {'sale_price': '1.00'}, format='json',
        )
        assert price.status_code == 403
        set_rls_context(organization_id=promoter.id)
        lot.refresh_from_db()
        assert str(lot.sale_price) == '30000000.00'

    def test_admin_keeps_accounts_reference_data_and_read_only_journal(self):
        _seed()
        admin = _login(ADMIN)
        assert admin.get(reverse('backoffice-user-search') + '?q=demo').status_code == 200
        assert admin.get(reverse('country-pack-list')).status_code == 200
        assert admin.get(reverse('admin-journal')).status_code == 200
        # Journal en lecture seule : aucune écriture exposée.
        assert admin.post(reverse('admin-journal'), {}, format='json').status_code == 405
        assert admin.delete(reverse('admin-journal')).status_code == 405

    def test_the_manager_does_the_business_work_instead(self):
        _seed()
        adv = _login(ADV)
        promoter, lot = _promoter_lot()
        assert adv.get(reverse('reservation-admin-list')).status_code == 200
        assert adv.get(reverse('backoffice-control-list')).status_code == 200
        created = adv.post(reverse('program-list'), {'organization': str(promoter.id), 'name': 'Programme ADV'}, format='json')
        assert created.status_code == 201, created.data
        price = adv.patch(
            reverse('lot-detail', args=[lot.id]) + f'?organization_id={promoter.id}', {'sale_price': '30000000.00'},
            format='json',
        )
        assert price.status_code == 200, price.data

    def test_journal_is_refused_to_business_roles(self):
        _seed()
        for email in (ADV, FINANCE):
            assert _login(email).get(reverse('admin-journal')).status_code == 403

    def test_journal_lists_business_acts(self):
        _seed()
        client1 = _login('client1.demo@keya.test')
        promoter, lot = _promoter_lot()
        client1.post(reverse('reservation-create'), {'lot': str(lot.id), 'organization': str(promoter.id)}, format='json')
        journal = _login(ADMIN).get(reverse('admin-journal')).json()
        # Adapté selon PO-2026-09-28-22 : « organisation · rôle », jamais l'e-mail.
        # Adapté selon PO-2026-09-28-34 puis -40 : « Awa Koné · Cliente fictive ».
        assert any(entry['actor'] == 'Awa Koné · Cliente fictive' for entry in journal)
        assert '@' not in str(journal)


# ─── K01–K03 : avis en ligne du contrôleur (CDC §7.1, T05/T06) ─────────────

from django.core.files.uploadedfile import SimpleUploadedFile  # noqa: E402

from apps.inspections.models import Inspection, Reserve  # noqa: E402
from apps.inspections.services import get_reserve_status, is_milestone_technically_accepted  # noqa: E402
from apps.programs.models import Milestone  # noqa: E402

CONSTRUCTEUR = 'constructeur.demo@keya.test'
INSPECTEUR = 'inspecteur.demo@keya.test'
_pdf_counter = 0


def _pdf():
    global _pdf_counter
    _pdf_counter += 1
    return SimpleUploadedFile(
        f'piece-{_pdf_counter}.pdf', f'%PDF-1.4\n% piece {_pdf_counter}\n%%EOF\n'.encode(), content_type='application/pdf',
    )


def _add_evidence(builder, declaration_id):
    document = builder.post(
        reverse('document-list'), {'file': _pdf(), 'category': 'rapport_chantier', 'source': 'mobile_app_photo'},
        format='multipart',
    )
    assert document.status_code == 201, document.data
    evidence = builder.post(
        reverse('evidence-list'), {'work_declaration': declaration_id, 'documents': [document.data['id']]}, format='json',
    )
    assert evidence.status_code == 201, evidence.data
    return evidence.data['id'], document.data['id']


def _assign(adv, promoter, declaration_id):
    inspector = User.objects.get(email=INSPECTEUR)
    response = adv.post(reverse('backoffice-mission-create'), {
        'organization': str(promoter.id), 'work_declaration': declaration_id, 'assigned_inspector': str(inspector.id),
    }, format='json')
    assert response.status_code == 201, response.data
    return response.data['id']


def _client_reservation_id(client, lot_id):
    """Dossier du client connecté sur ce lot (réservé avant le chantier)."""
    return next(row['id'] for row in client.get(reverse('my-reservations')).data if row['lot']['id'] == str(lot_id))


def _declared_foundations(client_email=None):
    """Le constructeur de démo déclare « Fondations » du Lot A1 avec une
    pièce ; le gestionnaire affecte le contrôleur de démo.
    PO-2026-09-29-09 : le chantier suit la concrétisation du dossier. Avec
    `client_email`, ce client réserve d'abord A1 et c'est son dossier qui est
    concrétisé (voir `_client_reservation_id`)."""
    _seed()
    builder = _login(CONSTRUCTEUR)
    promoter, lot = _promoter_lot()
    if client_email:
        reserved = _login(client_email).post(
            reverse('reservation-create'), {'lot': str(lot.id), 'organization': str(promoter.id)}, format='json',
        )
        assert reserved.status_code == 201, reserved.data
    set_rls_context(organization_id=promoter.id)
    milestone = Milestone.objects.get(lot=lot, code='fondations')
    commit_lot(lot)  # PO-2026-09-29-09 : chantier ouvert après concrétisation
    declared = builder.post(reverse('workdeclaration-list'), {'milestone': str(milestone.id)}, format='json')
    assert declared.status_code == 201, declared.data
    declaration_id = str(declared.data['id'])
    evidence_id, document_id = _add_evidence(builder, declaration_id)
    mission_id = _assign(_login(ADV), promoter, declaration_id)
    return builder, promoter, milestone, declaration_id, evidence_id, document_id, mission_id


def _opinion(inspector, mission_id, **payload):
    """PO-2026-09-28-20 : le contrôleur désigne explicitement les versions
    examinées. Sauf liste fournie par le test, l'aide désigne, comme l'app
    Contrôle, les pièces affichées dans la fiche de la mission."""
    if 'examined_evidence_ids' not in payload:
        detail = inspector.get(reverse('control-mission-detail', args=[mission_id]))
        if detail.status_code == 200:
            payload['examined_evidence_ids'] = [evidence['id'] for evidence in detail.data['evidences']]
    return inspector.post(reverse('control-mission-opinion', args=[mission_id]), payload, format='json')


@pytest.mark.django_db
class TestK01SubmittedPieces:
    def test_the_assigned_controller_sees_the_declaration_and_each_versioned_piece(self):
        _b, _p, _m, declaration_id, evidence_id, document_id, mission_id = _declared_foundations()
        detail = _login(INSPECTEUR).get(reverse('control-mission-detail', args=[mission_id]))
        assert detail.status_code == 200, detail.data
        assert detail.data['declaration']['id'] == declaration_id
        # Adapté selon PO-2026-09-28-18 : « organisation · rôle », jamais l'e-mail.
        assert detail.data['declaration']['declared_by'] == 'Constructeur Démonstration Abidjan · Constructeur'
        [evidence] = detail.data['evidences']
        assert (evidence['id'], evidence['version'], evidence['added_by']) == (
            evidence_id, 1, 'Constructeur Démonstration Abidjan · Constructeur',
        )
        assert CONSTRUCTEUR not in str(detail.data)
        assert evidence['documents'][0]['id'] == document_id
        assert len(evidence['documents'][0]['sha256']) == 64

    def test_the_controller_can_read_a_submitted_piece_but_nobody_else(self):
        _b, _p, _m, _d, _e, document_id, mission_id = _declared_foundations()
        url = reverse('control-mission-document', args=[mission_id, document_id])
        response = _login(INSPECTEUR).get(url)
        assert response.status_code == 200
        assert b''.join(response.streaming_content).startswith(b'%PDF')
        for email in (ADV, ADMIN, CONSTRUCTEUR):
            assert _login(email).get(url).status_code in (403, 404), email

    def test_the_opinion_records_the_examined_versions(self):
        _b, promoter, _m, _d, evidence_id, _doc, mission_id = _declared_foundations()
        response = _opinion(_login(INSPECTEUR), mission_id, outcome='conforme', examined_evidence_ids=[evidence_id])
        assert response.status_code == 201, response.data
        set_rls_context(organization_id=promoter.id)
        inspection = Inspection.objects.get(id=response.data['inspection_id'])
        assert inspection.examined_evidence_ids == [evidence_id]
        assert response.data['recorded_at']


@pytest.mark.django_db
class TestK02StructuredReserves:
    def test_a_negative_opinion_opens_several_structured_reserves_dated_by_the_server(self):
        _b, promoter, _m, _d, _e, _doc, mission_id = _declared_foundations()
        response = _opinion(_login(INSPECTEUR), mission_id, outcome='avec_reserve', note='Commentaire après décision', reserves=[
            {'motif': 'Enrobage insuffisant', 'expected_action': 'Reprendre l’enrobage'},
            {'motif': 'Photo illisible', 'expected_action': 'Fournir une photo nette'},
        ])
        assert response.status_code == 201, response.data
        set_rls_context(organization_id=promoter.id)
        reserves = Reserve.objects.filter(opened_by_inspection_id=response.data['inspection_id']).order_by('motif')
        assert [(r.motif, r.expected_action) for r in reserves] == [
            ('Enrobage insuffisant', 'Reprendre l’enrobage'), ('Photo illisible', 'Fournir une photo nette'),
        ]
        assert all(r.created_at is not None for r in reserves)

    def test_a_reserve_without_motif_or_expected_action_is_refused_and_nothing_is_written(self):
        _b, promoter, _m, _d, _e, _doc, mission_id = _declared_foundations()
        inspector = _login(INSPECTEUR)
        assert _opinion(inspector, mission_id, outcome='avec_reserve', reserves=[{'motif': 'Fissure'}]).status_code == 400
        assert _opinion(inspector, mission_id, outcome='avec_reserve').status_code == 400
        set_rls_context(organization_id=promoter.id)
        assert not Inspection.objects.exists()


@pytest.mark.django_db
class TestK03ExplicitDecisionPerReserveT06:
    def _with_reserve(self):
        builder, promoter, milestone, declaration_id, _e, _doc, mission_id = _declared_foundations()
        inspector = _login(INSPECTEUR)
        opened = _opinion(inspector, mission_id, outcome='avec_reserve', reserves=[
            {'motif': 'Enrobage insuffisant', 'expected_action': 'Reprendre l’enrobage'},
        ])
        assert opened.status_code == 201, opened.data
        set_rls_context(organization_id=promoter.id)
        reserve = Reserve.objects.get(opened_by_inspection_id=opened.data['inspection_id'])
        correction_evidence, _doc2 = _add_evidence(builder, declaration_id)
        correction = builder.post(
            reverse('reservecorrection-list'), {'reserve': str(reserve.id), 'evidence': correction_evidence}, format='json',
        )
        assert correction.status_code == 201, correction.data
        follow_up = _assign(_login(ADV), promoter, declaration_id)
        return promoter, milestone, reserve, inspector, follow_up

    def test_a_conforming_recontrol_without_an_explicit_decision_is_refused(self):
        promoter, milestone, reserve, inspector, follow_up = self._with_reserve()
        response = _opinion(inspector, follow_up, outcome='conforme')
        assert response.status_code == 400
        assert 'levée ou maintenue explicitement' in response.data['detail']
        set_rls_context(organization_id=promoter.id)
        assert get_reserve_status(reserve) == 'correction_proposee'
        assert not is_milestone_technically_accepted(milestone)

    def test_the_old_follow_up_route_no_longer_lifts_implicitly(self):
        promoter, _milestone, reserve, inspector, _follow_up = self._with_reserve()
        declaration_id = str(reserve.opened_by_inspection.work_declaration_id)
        response = inspector.post(reverse('inspection-list'), {
            'organization': str(promoter.id), 'work_declaration': declaration_id, 'outcome': 'conforme',
            'reserve': str(reserve.id),
        }, format='json')
        assert response.status_code == 400
        set_rls_context(organization_id=promoter.id)
        assert get_reserve_status(reserve) == 'correction_proposee'

    def test_maintained_reserve_stays_open_then_an_explicit_lift_accepts_the_milestone(self):
        promoter, milestone, reserve, inspector, follow_up = self._with_reserve()
        refused = _opinion(inspector, follow_up, outcome='conforme', decisions=[
            {'reserve_id': str(reserve.id), 'decision': 'maintenue', 'motif': 'Toujours insuffisant'},
        ])
        assert refused.status_code == 400
        maintained = _opinion(inspector, follow_up, outcome='avec_reserve', decisions=[
            {'reserve_id': str(reserve.id), 'decision': 'maintenue', 'motif': 'Toujours insuffisant'},
        ])
        assert maintained.status_code == 201, maintained.data
        set_rls_context(organization_id=promoter.id)
        assert get_reserve_status(reserve) == 'maintenue'
        assert not is_milestone_technically_accepted(milestone)

        second = _assign(_login(ADV), promoter, str(reserve.opened_by_inspection.work_declaration_id))
        lifted = _opinion(inspector, second, outcome='conforme', decisions=[
            {'reserve_id': str(reserve.id), 'decision': 'levee', 'motif': 'Enrobage conforme sur la pièce v2'},
        ])
        assert lifted.status_code == 201, lifted.data
        set_rls_context(organization_id=promoter.id)
        assert get_reserve_status(reserve) == 'levee'
        assert Inspection.objects.get(id=lifted.data['inspection_id']).reserve_decisions == [
            {'reserve_id': str(reserve.id), 'decision': 'levee', 'motif': 'Enrobage conforme sur la pièce v2'},
        ]
        assert is_milestone_technically_accepted(milestone)

    def test_t05_the_builder_cannot_decide_a_reserve(self):
        promoter, _milestone, reserve, _inspector, follow_up = self._with_reserve()
        builder = _login(CONSTRUCTEUR)
        assert _opinion(builder, follow_up, outcome='conforme', decisions=[
            {'reserve_id': str(reserve.id), 'decision': 'levee', 'motif': 'Je lève moi-même'},
        ]).status_code == 403
        set_rls_context(organization_id=promoter.id)
        assert get_reserve_status(reserve) == 'correction_proposee'

    def test_a_completed_mission_cannot_receive_a_second_opinion(self):
        _b, _p, _m, _d, _e, _doc, mission_id = _declared_foundations()
        inspector = _login(INSPECTEUR)
        assert _opinion(inspector, mission_id, outcome='conforme').status_code == 201
        assert _opinion(inspector, mission_id, outcome='conforme').status_code == 409
