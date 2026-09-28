"""Ticket B-056 — validation ADV, avis de paiement du client, confirmation
Finance, notifications (boîte de tâches transverse)."""
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import User
from apps.core.rls import set_rls_context

from .models import PaymentNotice, Reservation
from .tests import (
    _age_hold, _calls_url, _finance_scenario, _issue, _register, _reserve, _published_lot, _validate,
)


def _inbox(api):
    response = api.get(reverse('my-task-inbox') + '?status=pending')
    assert response.status_code == 200, response.data
    return response.data


def _sources(api):
    return sorted(task['source'].split(':')[0] for task in _inbox(api))


def _scenario():
    client, client_user, adv, promoter, lot, reservation_id = _finance_scenario()
    finance, _finance_user, _org = _register('finance')
    return client, client_user, adv, finance, promoter, lot, reservation_id


def _client_calls(client, reservation_id):
    return client.get(reverse('my-payment-calls', args=[reservation_id])).data


def _declare(client, call_id, reference='VIR-CLIENT-001', paid_on='2026-09-28'):
    return client.post(
        reverse('my-payment-notice-create', args=[call_id]),
        {'client_reference': reference, 'paid_on': paid_on}, format='json',
    )


def _notice_action(api, notice_id, promoter, action, data=None):
    return api.post(
        reverse(f'finance-payment-notice-{action}', args=[notice_id]) + f'?organization_id={promoter.id}',
        data or {}, format='json',
    )


def _status(promoter, reservation_id):
    set_rls_context(organization_id=promoter.id)
    return Reservation.objects.get(id=reservation_id).status


@pytest.mark.django_db
class TestAdvValidation:
    def test_the_adv_is_notified_validates_and_the_client_is_asked_to_pay(self):
        client, _client_user, adv, _finance, promoter, _lot, reservation_id = _scenario()
        assert 'reservation_to_validate' in _sources(adv)

        response = _validate(adv, reservation_id, promoter)

        assert response.status_code == 200, response.data
        assert response.data['validated_by'].startswith('gestionnaire_adv-')
        assert response.data['validated_at'] is not None
        assert 'reservation_to_validate' not in _sources(adv)
        calls = _client_calls(client, reservation_id)
        assert [(call['kind'], call['amount']) for call in calls] == [('frais', '100000.00')]
        assert calls[0]['payment_reference'].startswith('KEYIMMO-')
        assert calls[0]['payment_instructions']['simulation'] is True
        assert calls[0]['notice'] is None
        assert _sources(client) == ['payment_call_to_pay']

    def test_validation_restarts_the_payment_delay(self):
        _client, _user, adv, _finance, promoter, _lot, reservation_id = _scenario()
        set_rls_context(organization_id=promoter.id)
        Reservation.objects.filter(id=reservation_id).update(held_until=timezone.now() + timedelta(minutes=5))

        held_until = timezone.datetime.fromisoformat(_validate(adv, reservation_id, promoter).data['held_until'])

        assert held_until - timezone.now() > timedelta(hours=23)

    def test_validation_is_refused_twice_or_on_an_expired_hold(self):
        _client, _user, adv, _finance, promoter, _lot, reservation_id = _scenario()
        assert _validate(adv, reservation_id, promoter).status_code == 200
        assert _validate(adv, reservation_id, promoter).status_code == 409

        other_client, _u, _o = _register()
        _admin, other_promoter, other_lot = _published_lot()
        other_id = _reserve(other_client, other_promoter, other_lot).data['id']
        _age_hold(other_promoter, other_id)
        assert _validate(adv, other_id, other_promoter).status_code == 409

    def test_only_the_adv_validates(self):
        # Audit UI R1 (R02) : l'administrateur n'a plus ce pouvoir métier.
        client, _user, _adv, finance, promoter, _lot, reservation_id = _scenario()
        admin, _admin_user, _admin_org = _register('admin_keyimmo')
        for api in (client, finance, admin):
            assert _validate(api, reservation_id, promoter).status_code == 403


@pytest.mark.django_db
class TestPaymentNoticeCircuit:
    def _validated(self):
        client, client_user, adv, finance, promoter, lot, reservation_id = _scenario()
        assert _validate(adv, reservation_id, promoter).status_code == 200
        fee_call = _client_calls(client, reservation_id)[0]
        return client, client_user, adv, finance, promoter, reservation_id, fee_call

    def test_declare_then_finance_confirms_and_everyone_is_informed(self):
        client, _client_user, adv, finance, promoter, reservation_id, fee_call = self._validated()

        declared = _declare(client, fee_call['id'])
        assert declared.status_code == 201, declared.data
        assert declared.data['amount'] == '100000.00'
        # Une déclaration n'est pas une preuve : rien n'avance.
        assert _status(promoter, reservation_id) == 'held'
        assert _client_calls(client, reservation_id)[0]['notice']['status'] == 'declared'
        assert _client_calls(client, reservation_id)[0]['settlement'] == 'to_pay'
        assert 'payment_notice_to_confirm' in _sources(finance)

        pending = finance.get(reverse('finance-payment-notice-list')).data
        notice = next(row for row in pending if row['id'] == declared.data['id'])
        assert notice['client_reference'] == 'VIR-CLIENT-001'

        # Audit UI R1 (F02) : référence du relevé bancaire simulé, obligatoire.
        # Adapté selon PO-2026-09-28-10 : le montant reçu se lit au relevé.
        confirmed = _notice_action(
            finance, notice['id'], promoter, 'confirm', {'bank_reference': 'SIM-ENC-0001', 'amount': '100000'},
        )

        assert confirmed.status_code == 200, confirmed.data
        assert confirmed.data['status'] == 'confirmed'
        assert _status(promoter, reservation_id) == 'reserved'
        assert _client_calls(client, reservation_id)[0]['settlement'] == 'settled'
        assert 'payment_notice_to_confirm' not in _sources(finance)
        assert 'payment_received' in _sources(adv)
        assert _sources(client) == ['payment_received']
        received = next(task for task in _inbox(adv) if task['source'].startswith('payment_received'))
        assert 'Réservée' in received['label']

    def test_a_replayed_declaration_is_idempotent_and_a_second_one_waits(self):
        client, _u, _adv, _finance, _promoter, _rid, fee_call = self._validated()
        assert _declare(client, fee_call['id']).status_code == 201
        assert _declare(client, fee_call['id']).status_code == 200
        assert _declare(client, fee_call['id'], reference='AUTRE').status_code == 409

    def test_finance_rejects_with_a_reason_and_the_client_can_declare_again(self):
        client, _u, _adv, finance, promoter, reservation_id, fee_call = self._validated()
        notice_id = _declare(client, fee_call['id']).data['id']

        assert _notice_action(finance, notice_id, promoter, 'reject', {'reason': ''}).status_code == 400
        rejected = _notice_action(finance, notice_id, promoter, 'reject', {'reason': 'Virement introuvable sur le relevé'})

        assert rejected.status_code == 200
        assert rejected.data['status'] == 'rejected'
        assert _client_calls(client, reservation_id)[0]['notice']['rejection_reason'] == 'Virement introuvable sur le relevé'
        assert 'payment_notice_rejected' in _sources(client)
        assert _declare(client, fee_call['id'], reference='VIR-CLIENT-002').status_code == 201
        # Adapté selon PO-2026-09-28-10 : montant reçu fourni (lu au relevé).
        assert _notice_action(
            finance, notice_id, promoter, 'confirm', {'bank_reference': 'SIM-ENC-0001', 'amount': '100000'},
        ).status_code == 409

    def test_a_declared_payment_suspends_the_hold_expiry(self):
        client, _u, _adv, _finance, promoter, reservation_id, fee_call = self._validated()
        _declare(client, fee_call['id'])
        _age_hold(promoter, reservation_id)

        client.get(reverse('my-reservations'))

        assert _status(promoter, reservation_id) == 'held'

    def test_nobody_declares_for_another_client_and_only_finance_confirms(self):
        client, _u, adv, _finance, promoter, _rid, fee_call = self._validated()
        intruder, _i, _o = _register()
        assert _declare(intruder, fee_call['id']).status_code == 404

        notice_id = _declare(client, fee_call['id']).data['id']
        for api in (adv, client):
            assert _notice_action(api, notice_id, promoter, 'confirm').status_code == 403

    def test_a_notice_is_immutable(self):
        client, _u, _adv, _finance, promoter, _rid, fee_call = self._validated()
        notice_id = _declare(client, fee_call['id']).data['id']
        set_rls_context(organization_id=promoter.id)
        from django.db import DatabaseError, transaction

        with pytest.raises(DatabaseError), transaction.atomic():
            PaymentNotice.objects.filter(id=notice_id).update(amount=1)


@pytest.mark.django_db
class TestMyInbox:
    def test_a_user_completes_only_his_own_tasks(self):
        _client, _u, adv, _finance, promoter, _rid, = _scenario()[:6]
        task = _inbox(adv)[0]
        stranger, _s, _o = _register('gestionnaire_adv')

        assert stranger.post(
            reverse('my-task-inbox-complete', args=[task['id']]) + f'?organization_id={task["organization"]}',
        ).status_code == 404
        done = adv.post(
            reverse('my-task-inbox-complete', args=[task['id']]) + f'?organization_id={task["organization"]}',
        )
        assert done.status_code == 200
        assert done.data['status'] == 'done'
        # L'ADV du scénario, celui qui a publié le lot (audit R02 : le
        # gestionnaire, plus l'administrateur) et l'intrus.
        assert User.objects.filter(email__startswith='gestionnaire_adv-').count() == 3
