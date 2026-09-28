"""Audit UI R1 — étape 4 : décisions du Product Owner du 28 septembre 2026.

Chaque classe cite la décision (PO-2026-09-28-xx) et, le cas échéant, le
test CDC R1 (T01–T20) lié.
"""
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError

from apps.audit.models import AuditEvent
from apps.core.rls import set_rls_context
from apps.evidence.services import create_evidence
from apps.inspections.services import is_milestone_technically_accepted
from apps.organizations.models import CountryPack
from apps.pricing.services import activate_legal_payment_tier_template, create_legal_payment_tier_template

from .models import PaymentCall, Reservation
from .services import payment_schedule
from .tests import (
    _accept_milestone, _calls_url, _fee_call, _finance_scenario, _issue, _register, _set_reservation_status,
)


def _committed(seed_tiers=True):
    client, _user, adv, promoter, lot, reservation_id = _finance_scenario(seed_tiers=seed_tiers)
    _fee_call(adv, reservation_id, promoter)
    _set_reservation_status(promoter, reservation_id, 'reserved')
    assert _issue(adv, reservation_id, promoter, 'premier_versement').status_code == 201
    _set_reservation_status(promoter, reservation_id, 'committed')
    return client, adv, promoter, lot, reservation_id


@pytest.mark.django_db
class TestTierCallRuleIsACountryPackParameter:
    """PO-2026-09-28-03 — écart CDC §8.1 conservé, porté par le barème."""

    def test_the_demo_scale_marks_each_tier_and_is_not_legally_validated(self):
        _client, _adv, promoter, _lot, reservation_id = _committed()
        set_rls_context(organization_id=promoter.id)
        schedule = payment_schedule(Reservation.objects.get(id=reservation_id))
        assert schedule['legally_validated'] is False
        first, *tiers = schedule['rows']
        assert 'requires_technical_acceptance' not in first  # frais + premier versement : jamais conditionnés
        assert tiers and all(row['requires_technical_acceptance'] for row in tiers)
        assert all('après acceptation technique' in row['condition'] for row in tiers)

    def test_the_first_tier_can_never_require_an_acceptance(self):
        admin = _register('admin_keyimmo')[1]
        country_pack = CountryPack.objects.get(code='SN')
        with pytest.raises((ValidationError, DjangoValidationError)):
            create_legal_payment_tier_template(admin=admin, country_pack_id=country_pack.id, version=99, steps=[
                {'order': 1, 'code': 'reservation', 'label': 'Premier versement', 'cumulative_cap_percent': Decimal('10'),
                 'allows_progressive_payments': False, 'requires_technical_acceptance': True},
                {'order': 2, 'code': 'fondations', 'label': 'Fondations', 'cumulative_cap_percent': Decimal('100'),
                 'allows_progressive_payments': False},
            ])

    def test_a_tier_marked_unconditioned_is_callable_without_acceptance(self):
        _client, adv, promoter, _lot, reservation_id = _committed(seed_tiers=True)
        admin = _register('admin_keyimmo')[1]
        country_pack = CountryPack.objects.get(code='SN')
        template = create_legal_payment_tier_template(admin=admin, country_pack_id=country_pack.id, version=50, steps=[
            {'order': 1, 'code': 'reservation', 'label': 'Premier versement', 'cumulative_cap_percent': Decimal('10'),
             'allows_progressive_payments': False},
            {'order': 2, 'code': 'fondations', 'label': 'Fondations', 'cumulative_cap_percent': Decimal('100'),
             'allows_progressive_payments': False, 'requires_technical_acceptance': False},
        ])
        activate_legal_payment_tier_template(admin=admin, template_id=template.id)
        response = _issue(adv, reservation_id, promoter, 'versement', 'fondations')
        assert response.status_code == 201, response.data


@pytest.mark.django_db
class TestIssuedCallSurvivesAStaleAcceptanceT07:
    """PO-2026-09-28-03 et T07 — une pièce ajoutée après acceptation rend
    l'acceptation caduque ; l'appel déjà émis reste inchangé, aucun nouvel
    appel de palier ne devient émissible."""

    def test_the_issued_call_is_unchanged_and_nothing_is_cancelled(self):
        _client, adv, promoter, lot, reservation_id = _committed()
        milestone, declaration, inspector = _accept_milestone(promoter, lot['id'], 'fondations')
        issued = _issue(adv, reservation_id, promoter, 'versement', 'fondations')
        assert issued.status_code == 201, issued.data

        set_rls_context(organization_id=promoter.id)
        create_evidence(organization=promoter, work_declaration=declaration, documents=[], added_by=inspector)
        assert is_milestone_technically_accepted(milestone) is False

        set_rls_context(organization_id=promoter.id)
        call = PaymentCall.objects.get(id=issued.data['id'])
        assert (str(call.amount), call.tier_code) == (issued.data['amount'], 'fondations')
        listed = adv.get(_calls_url(reservation_id, promoter)).data
        assert issued.data['id'] in [row['id'] for row in listed['calls']]
        # Aucun appel du même palier ne peut être réémis, le suivant reste bloqué.
        assert _issue(adv, reservation_id, promoter, 'versement', 'fondations').status_code == 409
        assert _issue(adv, reservation_id, promoter, 'versement', 'gros_oeuvre').status_code == 409
        set_rls_context(organization_id=promoter.id)
        assert not AuditEvent.objects.filter(object_id=issued.data['id']).exclude(action='payment_call.issued').exists()


# ─── PO-2026-09-28-01, -02, -10 : encaissements et signalements ─────────────

from django.urls import reverse  # noqa: E402

from apps.programs.models import Lot  # noqa: E402

from .test_audit_ui_r1 import ADV, FINANCE, _login, _promoter_lot  # noqa: E402
from .test_audit_ui_r1_step2 import CLIENT as CLIENT_EMAIL  # noqa: E402
from .test_audit_ui_r1_step2 import _reserve_and_examine, _signal_fees  # noqa: E402


def _reserve_and_examine_second():
    """Yao réserve le Lot A2 (données déjà semées) ; le gestionnaire examine."""
    promoter, _lot = _promoter_lot()
    lot = Lot.objects.get(organization=promoter, name='Lot A2')
    client = _login('client2.demo@keya.test')
    reservation = client.post(reverse('reservation-create'), {'lot': str(lot.id), 'organization': str(promoter.id)}, format='json')
    assert reservation.status_code == 201, reservation.data
    examined = _login(ADV).post(
        reverse('reservation-validate', args=[reservation.data['id']]) + f'?organization_id={promoter.id}', format='json',
    )
    assert examined.status_code == 200, examined.data
    return client, None, promoter, reservation.data['id']


def _record_receipt(finance, promoter, reservation_id, reference='SIM-REL-0101', amount='100000'):
    response = finance.post(
        reverse('finance-receipt-create', args=[reservation_id]) + f'?organization_id={promoter.id}',
        {'bank_reference': reference, 'amount': amount, 'received_on': '2026-09-28'}, format='json',
    )
    assert response.status_code in (200, 201), response.data
    return response.data


def _notice_url(name, notice_id, promoter):
    return reverse(name, args=[notice_id]) + f'?organization_id={promoter.id}'


@pytest.mark.django_db
class TestFinanceReceiptsAndClientSignals:
    def test_finance_lists_recorded_receipts_with_their_file_and_linked_signals(self):
        client, _adv, promoter, reservation_id = _reserve_and_examine()
        finance = _login(FINANCE)
        receipt = _record_receipt(finance, promoter, reservation_id)
        listed = finance.get(reverse('finance-receipt-list'))
        assert listed.status_code == 200, listed.data
        row = next(item for item in listed.data if item['id'] == receipt['id'])
        assert row['bank_reference'] == 'SIM-REL-0101'
        # Adapté selon PO-2026-09-28-22 : « organisation · rôle », jamais l'e-mail.
        # Adapté selon PO-2026-09-28-40 : nom du jeu de démo sans mention.
        assert row['lot']['name'] and row['client']['full_name'] == 'Awa Koné'
        assert 'email' not in row['client']
        assert row['unallocated_amount'] == '100000.00' and row['notices'] == []
        assert _login(CLIENT_EMAIL).get(reverse('finance-receipt-list')).status_code == 403

    def test_a_signal_is_attached_to_an_existing_receipt_and_shows_its_reference(self):
        client, _adv, promoter, reservation_id = _reserve_and_examine()
        notice = _signal_fees(client, reservation_id)
        finance = _login(FINANCE)
        receipt = _record_receipt(finance, promoter, reservation_id)

        pending = finance.get(reverse('finance-payment-notice-list')).data
        candidates = next(row for row in pending if row['id'] == notice['id'])['attachable_receipts']
        assert [candidate['bank_reference'] for candidate in candidates] == ['SIM-REL-0101']

        attached = finance.post(
            _notice_url('finance-payment-notice-attach', notice['id'], promoter), {'receipt': receipt['id']}, format='json',
        )
        assert attached.status_code == 200, attached.data
        assert attached.data['status'] == 'confirmed'
        assert attached.data['receipt']['bank_reference'] == 'SIM-REL-0101'
        set_rls_context(organization_id=promoter.id)
        event = AuditEvent.objects.get(action='payment_notice.attached', object_id=notice['id'])
        assert event.payload['bank_reference'] == 'SIM-REL-0101'
        row = next(item for item in _login(FINANCE).get(reverse('finance-receipt-list')).data if item['id'] == receipt['id'])
        assert [linked['client_reference'] for linked in row['notices']] == ['VIR-AWA-0001']
        # Déjà traité : ni second rattachement ni clôture.
        again = _login(FINANCE).post(
            _notice_url('finance-payment-notice-attach', notice['id'], promoter), {'receipt': receipt['id']}, format='json',
        )
        assert again.status_code == 409

    def test_a_receipt_of_another_file_cannot_be_attached(self):
        client, _adv, promoter, reservation_id = _reserve_and_examine()
        notice = _signal_fees(client, reservation_id)
        _c2, _adv2, _p2, other_reservation_id = _reserve_and_examine_second()
        finance = _login(FINANCE)
        other = _record_receipt(finance, promoter, other_reservation_id, reference='SIM-REL-0202')
        response = finance.post(
            _notice_url('finance-payment-notice-attach', notice['id'], promoter), {'receipt': other['id']}, format='json',
        )
        assert response.status_code == 409
        assert 'même dossier' in response.data['detail']

    def test_closing_without_attachment_requires_a_reason_and_is_traced(self):
        client, _adv, promoter, reservation_id = _reserve_and_examine()
        notice = _signal_fees(client, reservation_id)
        finance = _login(FINANCE)
        url = _notice_url('finance-payment-notice-reject', notice['id'], promoter)
        assert finance.post(url, {'reason': '  '}, format='json').status_code == 400
        closed = finance.post(url, {'reason': 'Aucun virement correspondant au relevé du jour'}, format='json')
        assert closed.status_code == 200, closed.data
        assert closed.data['status_label'] == 'Clôturé sans rattachement'
        set_rls_context(organization_id=promoter.id)
        event = AuditEvent.objects.get(action='payment_notice.rejected', object_id=notice['id'])
        assert event.justification == 'Aucun virement correspondant au relevé du jour'

    def test_the_received_amount_is_read_from_the_statement_never_copied(self):
        client, _adv, promoter, reservation_id = _reserve_and_examine()
        notice = _signal_fees(client, reservation_id)
        response = _login(FINANCE).post(
            _notice_url('finance-payment-notice-confirm', notice['id'], promoter), {'bank_reference': 'SIM-REL-0303'},
            format='json',
        )
        assert response.status_code == 400
        assert 'amount' in response.data


# ─── PO-2026-09-28-04 : niveaux de confiance exposés par le serveur ─────────

from .test_audit_ui_r1 import CONSTRUCTEUR, INSPECTEUR, _declared_foundations, _opinion  # noqa: E402


def _build_rows(lot_id):
    response = _login(CONSTRUCTEUR).get(reverse('build-lot-milestones', args=[lot_id]))
    assert response.status_code == 200, response.data
    return {row['code']: row for row in response.data}


@pytest.mark.django_db
class TestTrustLevelsAreExposedWithTheirEvidence:
    def test_each_reached_level_says_who_which_role_when_which_version_and_scope(self):
        _b, _p, milestone, _d, evidence_id, _doc, mission_id = _declared_foundations()
        lot_id = milestone.lot_id
        levels = _build_rows(lot_id)['fondations']['trust_levels']
        assert set(levels) == {'declared', 'documented'}
        declared = levels['declared']
        assert set(declared) == {'by', 'role', 'at', 'version', 'scope'}
        assert declared['version'] == 'déclaration n° 1'
        assert declared['scope'] == 'Jalon « Fondations », Lot A1'
        assert levels['documented']['version'] == 'pièce v1'
        assert declared['by'] and declared['role'] and declared['at']

        response = _opinion(_login(INSPECTEUR), mission_id, outcome='conforme', examined_evidence_ids=[evidence_id])
        assert response.status_code == 201, response.data
        levels = _build_rows(lot_id)['fondations']['trust_levels']
        assert set(levels) == {'declared', 'documented', 'controlled', 'verified', 'validated'}
        assert levels['validated']['version'] == 'pièce v1'
        assert levels['validated']['role']  # le contrôleur est toujours cité
        # Élévation, jamais déclarée : aucun niveau (échelle vide à l'écran).
        assert _build_rows(lot_id)['elevation']['trust_levels'] == {}

    def test_a_negative_opinion_is_controlled_but_neither_verified_nor_validated(self):
        _b, _p, milestone, _d, _e, _doc, mission_id = _declared_foundations()
        response = _opinion(_login(INSPECTEUR), mission_id, outcome='avec_reserve', reserves=[
            {'motif': 'Fissure', 'expected_action': 'Reprendre l’enduit'},
        ])
        assert response.status_code == 201, response.data
        levels = _build_rows(milestone.lot_id)['fondations']['trust_levels']
        assert 'controlled' in levels and 'verified' not in levels and 'validated' not in levels

    def test_the_controller_sees_the_levels_of_the_milestone_under_review(self):
        _b, _p, _m, _d, _e, _doc, mission_id = _declared_foundations()
        detail = _login(INSPECTEUR).get(reverse('control-mission-detail', args=[mission_id]))
        assert detail.status_code == 200, detail.data
        assert set(detail.data['trust_levels']) == {'declared', 'documented'}

    def test_the_client_follows_the_worksite_of_his_own_property_only(self):
        _b, promoter, milestone, _d, _e, _doc, _mission = _declared_foundations()
        client = _login(CLIENT_EMAIL)
        set_rls_context(organization_id=promoter.id)
        reservation = client.post(
            reverse('reservation-create'), {'lot': str(milestone.lot_id), 'organization': str(promoter.id)}, format='json',
        )
        assert reservation.status_code == 201, reservation.data
        worksite = client.get(reverse('my-worksite', args=[reservation.data['id']]))
        assert worksite.status_code == 200, worksite.data
        rows = {row['code']: row for row in worksite.data}
        assert rows['fondations']['status_label'] == 'En examen'
        assert set(rows['fondations']['trust_levels']) == {'declared', 'documented'}
        assert _login('client2.demo@keya.test').get(reverse('my-worksite', args=[reservation.data['id']])).status_code == 404
