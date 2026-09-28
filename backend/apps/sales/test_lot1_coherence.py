"""Lot 1 — Cohérence (PO-2026-09-28-43, -50) : sortie d'une réservation
visible et expliquée au client (CDC §6.1), tâches du dossier closes,
reste à verser calculé par le serveur (P27), échéance jamais reportée à
l'examen du dossier (A1)."""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.core.rls import set_rls_context

from .models import Reservation, ReservationStatus
from .test_payment_circuit_b056 import _client_calls, _scenario, _sources
from .tests import (
    _age_hold, _allocate, _published_lot, _receipt, _reconcile, _register, _reserve, _validate,
)


def _mine(client, reservation_id):
    return next(row for row in client.get(reverse('my-reservations')).data if row['id'] == reservation_id)


@pytest.mark.django_db
class TestReservationEndIsExplained:
    def test_a_team_cancellation_shows_its_date_reason_and_role_to_the_client(self):
        client, _user, adv, _finance, promoter, _lot, reservation_id = _scenario()

        response = adv.post(
            reverse('reservation-admin-cancel', args=[reservation_id]) + f'?organization_id={promoter.id}',
            {'reason': 'Dossier incomplet (motif fictif)'}, format='json',
        )
        assert response.status_code == 200, response.data

        row = _mine(client, reservation_id)
        assert row['status'] == ReservationStatus.CANCELLED
        assert row['cancellation_reason'] == 'Dossier incomplet (motif fictif)'
        assert row['ended_at'] is not None
        assert row['ended_by']['kind'] == 'team'
        # PO-2026-09-28-18 : « organisation · rôle », jamais d'e-mail.
        assert row['ended_by']['label'].endswith(' · Gestionnaire')
        assert '@' not in row['ended_by']['label']

    def test_a_client_cancellation_is_attributed_to_the_client(self):
        client, _user, _org = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']

        assert client.post(reverse('my-reservation-cancel', args=[reservation_id])).status_code == 200

        row = _mine(client, reservation_id)
        assert row['ended_by'] == {'kind': 'client', 'label': None}
        assert row['ended_at'] is not None

    def test_an_expiry_shows_its_date_and_kind(self):
        client, _user, _org = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']
        _age_hold(promoter, reservation_id)

        row = _mine(client, reservation_id)

        assert row['status'] == ReservationStatus.EXPIRED
        assert row['ended_by'] == {'kind': 'expired', 'label': None}
        assert row['ended_at'] is not None

    def test_an_active_reservation_has_no_end(self):
        client, _user, _org = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']

        row = _mine(client, reservation_id)

        assert row['ended_at'] is None
        assert row['ended_by'] is None


@pytest.mark.django_db
class TestPendingTasksCloseWhenTheReservationEnds:
    def test_cancellation_closes_the_review_and_payment_tasks(self):
        client, _user, adv, _finance, promoter, _lot, reservation_id = _scenario()
        assert 'reservation_to_validate' in _sources(adv)
        assert _validate(adv, reservation_id, promoter).status_code == 200
        assert _sources(client) == ['payment_call_to_pay']

        adv.post(
            reverse('reservation-admin-cancel', args=[reservation_id]) + f'?organization_id={promoter.id}',
            {'reason': 'Motif fictif'}, format='json',
        )

        assert 'payment_call_to_pay' not in _sources(client)

    def test_expiry_closes_the_review_task(self):
        _client, _user, adv, _finance, promoter, _lot, reservation_id = _scenario()
        assert 'reservation_to_validate' in _sources(adv)
        _age_hold(promoter, reservation_id)

        # Expiration appliquée à la lecture (aucune tâche planifiée).
        adv.get(reverse('reservation-admin-list'))

        set_rls_context(organization_id=promoter.id)
        assert Reservation.objects.get(id=reservation_id).status == ReservationStatus.EXPIRED
        assert 'reservation_to_validate' not in _sources(adv)


@pytest.mark.django_db
class TestHoldDeadlineA1:
    def test_the_deadline_shown_to_the_client_does_not_move_at_validation(self):
        client, _user, adv, _finance, promoter, _lot, reservation_id = _scenario()
        before = _mine(client, reservation_id)['held_until']

        assert _validate(adv, reservation_id, promoter).status_code == 200

        assert _mine(client, reservation_id)['held_until'] == before


@pytest.mark.django_db
class TestRemainingAmountP27:
    def test_a_partial_payment_leaves_the_remaining_amount_to_pay(self):
        client, _user, adv, finance, promoter, _lot, reservation_id = _scenario()
        assert _validate(adv, reservation_id, promoter).status_code == 200
        call = _client_calls(client, reservation_id)[0]
        assert call['remaining_amount'] == call['amount']

        receipt = _receipt(finance, promoter, reservation_id, '40000.00').data
        assert _allocate(finance, promoter, receipt['id'], call['id'], '40000.00').status_code == 201
        assert _reconcile(finance, promoter, receipt['id']).status_code == 200

        call = _client_calls(client, reservation_id)[0]
        assert call['settlement'] == 'partial'
        assert Decimal(call['remaining_amount']) == Decimal(call['amount']) - Decimal('40000.00')
