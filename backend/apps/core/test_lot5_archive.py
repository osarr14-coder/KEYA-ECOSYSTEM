"""Lot 5 — archivage (PO-2026-09-28-47, arbitrages A6 et PO-2026-09-29-01 à
-04) : archivage depuis l'Administration (étape 11), archive consultable en
lecture seule par l'administrateur et le gestionnaire, aucune écriture sur
une archive quelle que soit la route, indicateurs actifs non contaminés,
journal intact (T14, T13, T16)."""
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.urls import get_resolver, reverse
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.core.archive import ArchivedInstanceError
from apps.core.demo import active_demo_instance
from apps.core.models import DemoInstance, DemoInstanceStatus
from apps.core.rls import set_rls_context
from apps.evidence.models import WorkDeclaration
from apps.organizations.models import Organization
from apps.programs.models import Lot, Milestone, Program
from apps.sales.management.commands.seed_demo_scenario import KEYIMMO_ORG, PROGRAM_NAME, PROMOTER_ORG
from apps.sales.models import Reservation, ReservationStatus
from apps.sales.test_audit_ui_r1 import (
    ADMIN, ADV, CONSTRUCTEUR, FINANCE, INSPECTEUR, _add_evidence, _login, _pdf, _promoter_lot,
)
from apps.sales.test_audit_ui_r1_step2 import CLIENT, _reserve_and_examine
from apps.sales.test_lot2_relais import _declare_foundations

VIEW = 'HTTP_X_DEMO_INSTANCE_VIEW'


def _played_instance():
    """Awa réserve A1 (dossier examiné) ; le constructeur déclare les
    fondations avec une pièce."""
    _client, _adv, promoter, reservation_id = _reserve_and_examine()
    builder = _login(CONSTRUCTEUR)
    _promoter, lot = _promoter_lot()
    _milestone, declaration_id = _declare_foundations(builder, promoter, lot)
    _add_evidence(builder, declaration_id)
    return promoter, reservation_id, declaration_id


def _archive(code=None):
    old = active_demo_instance()
    response = _login(ADMIN).post(
        reverse('admin-instance-archive'), {'confirm_code': code or old.code}, format='json',
    )
    return old, response


@pytest.mark.django_db
class TestArchiveFromAdministration:
    """Étape 11 (PO-2026-09-29-03)."""

    def test_typed_confirmation_is_required(self):
        _played_instance()
        old, response = _archive(code='DEMO-CI-AUTRE')
        assert response.status_code == 400
        assert 'confirm_code' in response.data
        old.refresh_from_db()
        assert old.status == DemoInstanceStatus.ACTIVE

    def test_archive_then_a_new_instance_from_the_versioned_dataset_journaled(self):
        _played_instance()
        old, response = _archive()

        assert response.status_code == 201, response.data
        old.refresh_from_db()
        new = active_demo_instance()
        assert old.status == DemoInstanceStatus.ARCHIVED and old.archived_at is not None
        assert len(old.program_ids) == 1
        assert new.code == response.data['created']['code'] != old.code
        assert new.origin == old and new.dataset_version == 'DEMO-CI-v2'
        promoter = Organization.objects.get(name=PROMOTER_ORG)
        set_rls_context(organization_id=promoter.id)
        program = Program.objects.get(demo_instance=new)
        assert program.name == PROGRAM_NAME
        lots = Lot.objects.filter(asset__program=program).order_by('name')
        assert [lot.name for lot in lots] == ['Lot A1', 'Lot A2']
        assert all(
            len(milestone.required_pieces) in (3, 4) for milestone in Milestone.objects.filter(lot__in=lots)
        )
        keyimmo = Organization.objects.get(name=KEYIMMO_ORG)
        set_rls_context(organization_id=keyimmo.id)
        assert set(AuditEvent.objects.filter(action__startswith='instance.').values_list('action', flat=True)) == {
            'instance.archived', 'instance.created',
        }
        # Comptes communs aux instances, inchangés : toujours utilisables.
        assert _login(CLIENT).get(reverse('my-reservations')).status_code == 200

    def test_only_the_administrator_archives(self):
        _played_instance()
        code = active_demo_instance().code
        for email in (ADV, FINANCE, CONSTRUCTEUR, INSPECTEUR, CLIENT):
            response = _login(email).post(reverse('admin-instance-archive'), {'confirm_code': code}, format='json')
            assert response.status_code == 403, email
        assert active_demo_instance().code == code


@pytest.mark.django_db
class TestT14NewInstanceIsBlank:
    def test_the_builder_no_longer_sees_the_payments_of_an_archive(self):
        """Vérification finale : « Paiements reçus » listait encore une sortie
        de l'instance archivée."""
        from apps.sales.tests import _disbursement_scenario, _executed_disbursement

        s = _disbursement_scenario()
        _executed_disbursement(s)
        assert len(s['constructeur'].get(reverse('beneficiary-disbursement-list')).data) == 1
        DemoInstance.objects.create(code='DEMO-CI-TEST-ACTIVE', dataset_version='DEMO-CI-v2')

        assert s['constructeur'].get(reverse('beneficiary-disbursement-list')).data == []

    def test_active_screens_and_indicators_start_again(self):
        _promoter, reservation_id, _declaration = _played_instance()
        _archive()

        assert _login(CLIENT).get(reverse('my-reservations')).data == []
        assert _login(ADV).get(reverse('reservation-admin-list')).data == []
        indicators = _login(ADV).get(reverse('pilotage-indicators')).data['indicators']
        for key in ('jalons', 'entrees', 'sorties', 'pieces'):
            assert indicators[key]['denominator'] == 0, key
        # La cloche ne compte plus les tâches de l'archive.
        assert _login(ADV).get(reverse('my-tasks') + '?status=pending').data == []
        assert _login(CLIENT).get(reverse('my-payment-calls', args=[reservation_id])).status_code == 404


@pytest.mark.django_db
class TestArchiveConsultation:
    """PO-2026-09-29-01 (A6) : administrateur et gestionnaire seulement."""

    def test_the_manager_reads_the_archive_with_its_own_indicators(self):
        _promoter, reservation_id, _declaration = _played_instance()
        old, _response = _archive()
        adv = _login(ADV)

        listing = adv.get(reverse('reservation-admin-list'), **{VIEW: old.code})

        assert listing.status_code == 200
        assert [row['id'] for row in listing.data] == [reservation_id]
        assert listing['X-Demo-Instance-View'] == f'{old.code}; ARCHIVED'
        indicators = adv.get(reverse('pilotage-indicators'), **{VIEW: old.code}).data['indicators']
        assert (indicators['jalons']['denominator'], indicators['pieces']['denominator']) == (1, 4)
        chronology = adv.get(reverse('dossier-chronology', args=[reservation_id]), **{VIEW: old.code})
        assert chronology.status_code == 200
        assert 'Jalon déclaré' in [entry['action'] for entry in chronology.data['entries']]
        # Sans l'en-tête : l'instance active, vierge.
        assert adv.get(reverse('reservation-admin-list')).data == []

    def test_other_roles_are_refused_and_unknown_codes_not_found(self):
        _played_instance()
        old, _response = _archive()
        for email in (FINANCE, CONSTRUCTEUR, INSPECTEUR, CLIENT):
            assert _login(email).get(reverse('my-tasks'), **{VIEW: old.code}).status_code == 403, email
        assert _login(ADV).get(reverse('reservation-admin-list'), **{VIEW: 'DEMO-INCONNUE'}).status_code == 404

    def test_journal_intact_and_restricted_to_the_archive_period(self):
        """T16."""
        _played_instance()
        old, _response = _archive()
        admin = _login(ADMIN)

        whole = admin.get(reverse('admin-journal')).data
        archived = admin.get(reverse('admin-journal'), **{VIEW: old.code}).data

        actions = {row['action'] for row in archived}
        assert {'reservation.requested', 'reservation.held', 'reservation.validated'} <= actions
        assert not any(row['action'].startswith('instance.') for row in archived)
        assert {'instance.archived', 'instance.created'} <= {row['action'] for row in whole}
        assert len(whole) > len(archived)

    def test_an_overdue_hold_in_an_archive_never_expires(self):
        promoter, reservation_id, _declaration = _played_instance()
        set_rls_context(organization_id=promoter.id)
        Reservation.objects.filter(id=reservation_id).update(held_until=timezone.now() - timedelta(hours=1))
        old, _response = _archive()

        listing = _login(ADV).get(reverse('reservation-admin-list') + '?status=held', **{VIEW: old.code})

        assert listing.status_code == 200
        set_rls_context(organization_id=promoter.id)
        assert Reservation.objects.get(id=reservation_id).status == ReservationStatus.HELD


def _write_routes():
    """Toutes les routes nommées de l'API, avec des arguments factices."""
    dummy = '00000000-0000-0000-0000-000000000001'

    def walk(resolver, prefix=''):
        for pattern in resolver.url_patterns:
            if hasattr(pattern, 'url_patterns'):
                yield from walk(pattern, prefix + str(pattern.pattern))
            elif pattern.name and (prefix + str(pattern.pattern)).startswith('api/'):
                yield pattern

    for pattern in walk(get_resolver()):
        names = list(pattern.pattern.regex.groupindex)
        for value in (dummy, 1, 'x'):
            try:
                yield pattern.name, reverse(pattern.name, kwargs={name: value for name in names})
                break
            except Exception:  # noqa: BLE001 — convertisseur incompatible, valeur suivante
                continue


@pytest.mark.django_db
class TestNoWriteOnAnArchive:
    """PO-2026-09-29-02 (§10) — garde 1 : toute écriture qui consulte une
    archive est refusée, sur TOUTES les routes ; garde 2 : aucun objet
    d'une archive ne s'enregistre, même sans l'en-tête."""

    def test_every_api_route_refuses_writes_while_an_archive_is_viewed(self):
        _played_instance()
        old, _response = _archive()
        routes = list(_write_routes())
        assert len(routes) > 100
        for email in (ADV, ADMIN):
            user = _login(email)
            for name, url in routes:
                for method in ('post', 'put', 'patch', 'delete'):
                    response = getattr(user, method)(url, {}, format='json', **{VIEW: old.code})
                    assert response.status_code == 409, (email, name, method, response.status_code)
                    assert 'lecture seule' in response.json()['detail']

    def test_old_objects_refuse_writes_even_without_the_header(self):
        promoter, reservation_id, declaration_id = _played_instance()
        _archive()

        issued = _login(ADV).post(
            reverse('payment-call-team', args=[reservation_id]) + f'?organization_id={promoter.id}',
            {'kind': 'frais'}, format='json',
        )
        assert issued.status_code == 409, (issued.status_code, issued.data)
        builder = _login(CONSTRUCTEUR)
        document = builder.post(
            reverse('document-list'), {'file': _pdf(), 'category': 'preuve_chantier', 'source': 'control_tower_upload'},
            format='multipart',
        )
        deposit = builder.post(
            reverse('evidence-list'), {'work_declaration': declaration_id, 'documents': [document.data['id']]}, format='json',
        )
        assert deposit.status_code == 409, (deposit.status_code, deposit.data)
        inspector = User.objects.get(email=INSPECTEUR)
        mission = _login(ADV).post(reverse('backoffice-mission-create'), {
            'organization': str(promoter.id), 'work_declaration': declaration_id,
            'assigned_inspector': str(inspector.id),
        }, format='json')
        assert mission.status_code == 409, (mission.status_code, mission.data)

    def test_the_model_guard_refuses_any_save_of_an_archived_object(self):
        promoter, reservation_id, declaration_id = _played_instance()
        _archive()
        set_rls_context(organization_id=promoter.id)
        reservation = Reservation.objects.get(id=reservation_id)
        reservation.status = ReservationStatus.CANCELLED
        with pytest.raises(ArchivedInstanceError):
            reservation.save()
        declaration = WorkDeclaration.objects.get(id=declaration_id)
        with pytest.raises(ArchivedInstanceError):
            WorkDeclaration.objects.create(
                organization=promoter, milestone=declaration.milestone, declared_by=declaration.declared_by,
            )


@pytest.mark.django_db
class TestRetention:
    """A6, PO-2026-09-29-04 : fin de campagne + 90 jours."""

    def test_no_campaign_end_means_nothing_expires(self, monkeypatch):
        monkeypatch.delenv('DEMO_CAMPAIGN_END', raising=False)
        _played_instance()
        _archive()
        rows = _login(ADMIN).get(reverse('admin-instances')).data
        assert rows['campaign_end'] is None
        assert all(row['retention_until'] is None for row in rows['instances'])

    def test_an_archive_past_retention_is_listed_and_journaled_never_deleted(self, monkeypatch, capsys):
        monkeypatch.setenv('DEMO_CAMPAIGN_END', (timezone.now().date() - timedelta(days=100)).isoformat())
        _played_instance()
        old, _response = _archive()

        rows = {row['code']: row for row in _login(ADV).get(reverse('admin-instances')).data['instances']}
        assert rows[old.code]['retention_expired'] is True
        assert rows[active_demo_instance().code]['retention_until'] is None
        call_command('check_archive_retention', record=True)
        assert '1 archive(s) échue(s).' in capsys.readouterr().out
        keyimmo = Organization.objects.get(name=KEYIMMO_ORG)
        set_rls_context(organization_id=keyimmo.id)
        assert AuditEvent.objects.filter(action='instance.retention_expired').count() == 1
        assert DemoInstance.objects.filter(code=old.code).exists()

    def test_the_instance_list_is_for_the_administrator_and_the_manager(self):
        _played_instance()
        for email in (FINANCE, CONSTRUCTEUR, CLIENT):
            assert _login(email).get(reverse('admin-instances')).status_code == 403, email
