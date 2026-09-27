import threading
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.db import DatabaseError, connection, transaction
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Membership, Organization, Role
from apps.programs.models import Lot

from . import services
from .models import ContractVersion, Reservation, ReservationStatus

PASSWORD = 'strongpass123'
PRICE = '30000000.00'

_sequence = 0


def _next():
    global _sequence
    _sequence += 1
    return _sequence


def _login(client, email):
    token = client.post(reverse('login'), {'email': email, 'password': PASSWORD}, format='json').data['access']
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')


def _register(role='client'):
    """Même mécanique que les autres modules de test (duplication assumée,
    voir apps/programs/tests.py) : inscription réelle, puis bascule de rôle
    en base (aucun endpoint d'attribution de rôle, ticket 001)."""
    suffix = _next()
    email = f'{role}-{suffix}@example.com'
    client = APIClient()
    client.post(
        reverse('register'),
        {'email': email, 'password': PASSWORD, 'organization_name': f'Org {role} {suffix}', 'role': 'client'},
        format='json',
    )
    user = User.objects.get(email=email)
    organization = Membership.objects.get(user=user).organization
    if role != 'client':
        set_rls_context(user_id=user.id, organization_id=organization.id)
        role_obj, _ = Role.objects.get_or_create(code=role, defaults={'label': role})
        Membership.objects.filter(user=user, organization=organization).update(role=role_obj)
    _login(client, email)
    return client, user, organization


def _published_lot(price=PRICE, name=None):
    """Lot publié dans une organisation « promoteur » dont aucun client de
    ces tests n'est membre — créé via l'API admin, comme en production."""
    admin_client, _admin_user, _admin_org = _register('admin_keyimmo')
    promoter = Organization.objects.create(
        name=f'Promoteur {_next()}', country_pack=CountryPack.objects.get(code='SN'),
    )
    program = admin_client.post(
        reverse('program-list'), {'organization': str(promoter.id), 'name': 'Résidence Démonstration'}, format='json',
    ).data
    asset = admin_client.post(
        reverse('asset-list'),
        {'organization': str(promoter.id), 'program': program['id'], 'name': 'Bâtiment A', 'location': 'Abidjan'},
        format='json',
    ).data
    lot = admin_client.post(
        reverse('lot-list'),
        {'organization': str(promoter.id), 'asset': asset['id'], 'name': name or f'Lot {_next()}', 'surface': '82.00'},
        format='json',
    ).data
    if price is not None:
        admin_client.patch(
            reverse('lot-detail', args=[lot['id']]) + f'?organization_id={promoter.id}',
            {'sale_price': price}, format='json',
        )
    return admin_client, promoter, lot


def _reserve(client, promoter, lot):
    return client.post(
        reverse('reservation-create'), {'lot': lot['id'], 'organization': str(promoter.id)}, format='json',
    )


def _lot_status(promoter, lot):
    set_rls_context(organization_id=promoter.id)
    return Lot.objects.get(id=lot['id']).commercial_status


def _age_hold(promoter, reservation_id):
    """Simule l'échéance dépassée — écrit sous le contexte de l'organisation
    du lot (policy UPDATE)."""
    set_rls_context(organization_id=promoter.id)
    Reservation.objects.filter(id=reservation_id).update(held_until=timezone.now() - timedelta(minutes=1))


@pytest.mark.django_db
class TestCatalog:
    def test_only_published_lots_of_every_organization_are_listed(self):
        client, _user, _org = _register()
        _admin, promoter, priced = _published_lot()
        _admin_b, _promoter_b, unpriced = _published_lot(price=None)

        response = client.get(reverse('catalog-lot-list'))

        assert response.status_code == 200
        ids = {row['id'] for row in response.data}
        assert priced['id'] in ids
        assert unpriced['id'] not in ids
        row = next(row for row in response.data if row['id'] == priced['id'])
        assert row['organization']['id'] == str(promoter.id)
        assert row['sale_price'] == PRICE
        assert row['currency'] == 'XOF'
        assert row['asset']['location'] == 'Abidjan'


@pytest.mark.django_db
class TestReservationRequest:
    def test_a_client_holds_a_lot_with_its_price_frozen_and_the_lot_marked_reserved(self):
        client, user, _org = _register()
        admin_client, promoter, lot = _published_lot()

        response = _reserve(client, promoter, lot)

        assert response.status_code == 201, response.data
        assert response.data['status'] == ReservationStatus.HELD
        assert response.data['price_amount'] == PRICE
        assert response.data['currency'] == 'XOF'
        held_until = timezone.datetime.fromisoformat(response.data['held_until'])
        assert abs((held_until - timezone.now()) - timedelta(hours=24)) < timedelta(minutes=1)
        assert _lot_status(promoter, lot) == 'reserve'

        # Prix figé : un changement ultérieur du prix du lot ne touche jamais
        # la réservation en cours.
        admin_client.patch(
            reverse('lot-detail', args=[lot['id']]) + f'?organization_id={promoter.id}',
            {'sale_price': '99000000.00'}, format='json',
        )
        set_rls_context(organization_id=promoter.id)
        assert Reservation.objects.get(id=response.data['id']).price_amount == Decimal(PRICE)

        actions = list(
            AuditEvent.objects.filter(object_id=response.data['id']).order_by('id').values_list('action', flat=True),
        )
        assert actions == ['reservation.requested', 'reservation.held']
        assert AuditEvent.objects.filter(object_id=response.data['id'], actor=user).count() == 2

    def test_a_second_client_is_refused_explicitly_and_the_lot_leaves_the_catalog(self):
        first, _u1, _o1 = _register()
        second, _u2, _o2 = _register()
        _admin, promoter, lot = _published_lot()
        assert _reserve(first, promoter, lot).status_code == 201

        response = _reserve(second, promoter, lot)

        assert response.status_code == 409
        assert 'plus disponible' in response.data['detail']
        assert all(row['id'] != lot['id'] for row in second.get(reverse('catalog-lot-list')).data)

    def test_an_unpriced_lot_is_not_reservable(self):
        client, _user, _org = _register()
        _admin, promoter, lot = _published_lot(price=None)
        assert _reserve(client, promoter, lot).status_code == 409

    def test_a_wrong_organization_for_the_lot_is_refused(self):
        client, _user, own_org = _register()
        _admin, _promoter, lot = _published_lot()
        assert _reserve(client, own_org, lot).status_code == 409

    def test_only_the_client_role_may_request_a_reservation(self):
        sponsor, _user, _org = _register('sponsor')
        _admin, promoter, lot = _published_lot()
        assert _reserve(sponsor, promoter, lot).status_code == 403


@pytest.mark.django_db(transaction=True)
class TestReservationConcurrencyT01:
    """CDC T01 — deux clients demandent SIMULTANÉMENT le même lot : deux
    vraies connexions (deux threads), lancées ensemble par une barrière (même
    discipline que apps/tasks/tests.py::TestTaskCreationRaceUnderConcurrency).
    Une seule réservation bloquante ; l'autre reçoit un refus explicite."""

    def test_two_simultaneous_requests_give_exactly_one_hold(self):
        with transaction.atomic():
            _client_a, user_a, org_a = _register()
            _client_b, user_b, org_b = _register()
            _admin, promoter, lot = _published_lot()

        barrier = threading.Barrier(2, timeout=5)
        outcomes = []
        lock = threading.Lock()

        def worker(user, own_org):
            try:
                barrier.wait()
                with transaction.atomic():
                    set_rls_context(user_id=user.id, organization_id=own_org.id)
                    services.request_reservation(
                        client=user, caller_organization_id=own_org.id,
                        lot_organization_id=promoter.id, lot_id=lot['id'],
                    )
                with lock:
                    outcomes.append('held')
            except services.LotUnavailableError:
                with lock:
                    outcomes.append('refused')
            except Exception as exc:  # noqa: BLE001 — toute autre erreur est le bug à révéler
                with lock:
                    outcomes.append(f'error: {exc!r}')
            finally:
                connection.close()

        threads = [
            threading.Thread(target=worker, args=(user_a, org_a)),
            threading.Thread(target=worker, args=(user_b, org_b)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)

        assert sorted(outcomes) == ['held', 'refused']
        with transaction.atomic():
            set_rls_context(organization_id=promoter.id)
            assert Reservation.objects.filter(lot_id=lot['id'], status=ReservationStatus.HELD).count() == 1


@pytest.mark.django_db
class TestReservationExpiryT02:
    def test_an_expired_hold_frees_the_lot_keeps_its_event_and_allows_a_new_request(self):
        first, _u1, _o1 = _register()
        second, _u2, _o2 = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(first, promoter, lot).data['id']
        _age_hold(promoter, reservation_id)

        # Libéré dès le premier accès : aucune tâche planifiée requise.
        assert any(row['id'] == lot['id'] for row in second.get(reverse('catalog-lot-list')).data)
        set_rls_context(organization_id=promoter.id)
        assert Reservation.objects.get(id=reservation_id).status == ReservationStatus.EXPIRED
        expired_event = AuditEvent.objects.get(object_id=reservation_id, action='reservation.expired')
        assert expired_event.actor is None

        response = _reserve(second, promoter, lot)
        assert response.status_code == 201
        assert _lot_status(promoter, lot) == 'reserve'

    def test_the_client_sees_his_own_hold_expired(self):
        client, _user, _org = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']
        _age_hold(promoter, reservation_id)

        rows = client.get(reverse('my-reservations')).data

        assert [row['status'] for row in rows if row['id'] == reservation_id] == [ReservationStatus.EXPIRED]
        assert _lot_status(promoter, lot) == 'disponible'

    def test_the_sweep_command_expires_overdue_holds(self):
        client, _user, _org = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']
        _age_hold(promoter, reservation_id)

        call_command('expire_reservations')

        set_rls_context(organization_id=promoter.id)
        assert Reservation.objects.get(id=reservation_id).status == ReservationStatus.EXPIRED


@pytest.mark.django_db
class TestClientReservations:
    def test_a_client_sees_only_his_reservations_with_the_lot_details(self):
        client_a, _ua, _oa = _register()
        client_b, _ub, _ob = _register()
        _admin, promoter, lot = _published_lot(name='Lot Visible A')
        _admin2, promoter_2, lot_2 = _published_lot(name='Lot Visible B')
        reservation_a = _reserve(client_a, promoter, lot).data['id']
        _reserve(client_b, promoter_2, lot_2)

        rows = client_a.get(reverse('my-reservations')).data

        assert [row['id'] for row in rows] == [reservation_a]
        assert rows[0]['lot']['name'] == 'Lot Visible A'
        assert rows[0]['program']['name'] == 'Résidence Démonstration'

    def test_a_client_cancels_his_hold_and_the_lot_becomes_available_again(self):
        client, _user, _org = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']

        response = client.post(reverse('my-reservation-cancel', args=[reservation_id]))

        assert response.status_code == 200
        assert response.data['status'] == ReservationStatus.CANCELLED
        assert _lot_status(promoter, lot) == 'disponible'
        assert AuditEvent.objects.filter(object_id=reservation_id, action='reservation.cancelled').exists()
        # Une seconde annulation est refusée, jamais silencieuse.
        assert client.post(reverse('my-reservation-cancel', args=[reservation_id])).status_code == 409

    def test_a_client_cannot_cancel_another_clients_reservation(self):
        owner, _u1, _o1 = _register()
        intruder, _u2, _o2 = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(owner, promoter, lot).data['id']

        response = intruder.post(reverse('my-reservation-cancel', args=[reservation_id]))

        assert response.status_code == 404
        set_rls_context(organization_id=promoter.id)
        assert Reservation.objects.get(id=reservation_id).status == ReservationStatus.HELD


@pytest.mark.django_db
class TestAdminReservations:
    def test_adv_lists_every_reservation_and_cancels_with_a_mandatory_reason(self):
        client, user, _org = _register()
        adv, _adv_user, _adv_org = _register('gestionnaire_adv')
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']

        listing = adv.get(reverse('reservation-admin-list'))
        assert listing.status_code == 200
        row = next(row for row in listing.data if row['id'] == reservation_id)
        assert row['client']['email'] == user.email

        url = reverse('reservation-admin-cancel', args=[reservation_id]) + f'?organization_id={promoter.id}'
        assert adv.post(url, {'reason': '   '}, format='json').status_code in (400, 409)
        response = adv.post(url, {'reason': 'Dossier incomplet'}, format='json')
        assert response.status_code == 200
        assert response.data['status'] == ReservationStatus.CANCELLED
        assert response.data['cancellation_reason'] == 'Dossier incomplet'
        assert _lot_status(promoter, lot) == 'disponible'

    def test_an_ordinary_client_cannot_use_the_admin_routes(self):
        client, _user, _org = _register()
        assert client.get(reverse('reservation-admin-list')).status_code == 403


@pytest.mark.django_db
class TestLotConsistency:
    def test_manual_status_change_is_refused_during_a_hold_and_allowed_after(self):
        client, _user, _org = _register()
        admin_client, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']
        url = reverse('lot-detail', args=[lot['id']]) + f'?organization_id={promoter.id}'

        assert admin_client.patch(url, {'commercial_status': 'disponible'}, format='json').status_code == 409
        assert _lot_status(promoter, lot) == 'reserve'

        client.post(reverse('my-reservation-cancel', args=[reservation_id]))
        assert admin_client.patch(url, {'commercial_status': 'vendu'}, format='json').status_code == 200

    def test_a_reserved_lot_cannot_be_deleted_and_the_error_is_explicit(self):
        client, _user, _org = _register()
        admin_client, promoter, lot = _published_lot()
        _reserve(client, promoter, lot)

        response = admin_client.delete(reverse('lot-detail', args=[lot['id']]) + f'?organization_id={promoter.id}')

        assert response.status_code == 400
        set_rls_context(organization_id=promoter.id)
        assert Lot.objects.filter(id=lot['id']).exists()


@pytest.mark.django_db
class TestAuditEventIsAppendOnly:
    """Même preuve que `apps/trust/tests.py::TestAppendOnly` (ticket 003) :
    sans policy UPDATE/DELETE, PostgreSQL rend la ligne invisible à ces
    commandes (0 ligne, aucune exception) ; le trigger est le filet qui
    tiendrait même si une telle policy était ajoutée par erreur."""

    def _event(self):
        client, _user, _org = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']
        set_rls_context(organization_id=promoter.id)
        return AuditEvent.objects.filter(object_id=reservation_id).first()

    def test_update_and_delete_affect_zero_rows_and_leave_the_event_intact(self):
        event = self._event()

        with connection.cursor() as cursor:
            cursor.execute('UPDATE audit_event SET action = %s WHERE id = %s', ['falsifié', event.id])
            assert cursor.rowcount == 0
            cursor.execute('DELETE FROM audit_event WHERE id = %s', [event.id])
            assert cursor.rowcount == 0

        assert AuditEvent.objects.get(id=event.id).action == event.action

    def test_append_only_triggers_exist_in_the_database(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_event'::regclass AND NOT tgisinternal",
            )
            assert {row[0] for row in cursor.fetchall()} == {'audit_event_no_update', 'audit_event_no_delete'}


# ─── Contrat fictif versionné — ticket B-049 ──────────────────────────────

CONTRACT_TEXT = 'Contrat de réservation fictif — Lot A12, prix 30 000 000 XOF. DÉMONSTRATION.'


def _reservation_with(client_api=None):
    client_api, client_user, _org = client_api or _register()
    adv, adv_user, _adv_org = _register('gestionnaire_adv')
    _admin, promoter, lot = _published_lot()
    reservation_id = _reserve(client_api, promoter, lot).data['id']
    return client_api, client_user, adv, adv_user, promoter, reservation_id


def _contracts_url(reservation_id, promoter):
    return reverse('contract-admin-list-create', args=[reservation_id]) + f'?organization_id={promoter.id}'


def _transition(adv, contract_id, promoter, action):
    return adv.post(
        reverse('contract-admin-transition', args=[contract_id]) + f'?organization_id={promoter.id}',
        {'action': action}, format='json',
    )


def _approved_contract(adv, promoter, reservation_id, text=CONTRACT_TEXT):
    contract = adv.post(_contracts_url(reservation_id, promoter), {'content': text}, format='json').data
    assert _transition(adv, contract['id'], promoter, 'submit').status_code == 200
    assert _transition(adv, contract['id'], promoter, 'approve').status_code == 200
    return contract


@pytest.mark.django_db
class TestContractLifecycle:
    def test_adv_drafts_submits_approves_then_the_client_signs(self):
        client, client_user, adv, adv_user, promoter, reservation_id = _reservation_with()

        created = adv.post(_contracts_url(reservation_id, promoter), {'content': CONTRACT_TEXT}, format='json')
        assert created.status_code == 201, created.data
        assert created.data['version'] == 1
        assert created.data['status'] == 'draft'
        assert created.data['simulation'] is True
        contract_id = created.data['id']

        assert _transition(adv, contract_id, promoter, 'submit').data['status'] == 'review'
        approved = _transition(adv, contract_id, promoter, 'approve')
        assert approved.data['status'] == 'approved'
        assert approved.data['approved_by'] == adv_user.email

        signed = client.post(reverse('my-contract-sign', args=[contract_id]))
        assert signed.status_code == 200
        assert signed.data['status'] == 'signed_simulated'
        assert signed.data['signed_at'] is not None
        # « La version approuvée ne change pas lors de la signature. »
        assert signed.data['content'] == CONTRACT_TEXT

        # Journal cloisonné par organisation : lu sous celle du lot.
        set_rls_context(organization_id=promoter.id)
        actions = list(AuditEvent.objects.filter(object_id=contract_id).order_by('id').values_list('action', flat=True))
        assert actions == ['contract.created', 'contract.submitted', 'contract.approved', 'contract.signed_simulated']

    def test_a_draft_can_be_edited_and_returned_to_draft_from_review(self):
        _client, _user, adv, _adv_user, promoter, reservation_id = _reservation_with()
        contract_id = adv.post(_contracts_url(reservation_id, promoter), {'content': 'v1'}, format='json').data['id']
        edit_url = reverse('contract-admin-update', args=[contract_id]) + f'?organization_id={promoter.id}'

        assert adv.patch(edit_url, {'content': 'v1 corrigée'}, format='json').data['content'] == 'v1 corrigée'
        _transition(adv, contract_id, promoter, 'submit')
        # Figé dès la soumission.
        assert adv.patch(edit_url, {'content': 'retouche'}, format='json').status_code == 409
        assert _transition(adv, contract_id, promoter, 'back_to_draft').data['status'] == 'draft'
        assert adv.patch(edit_url, {'content': 'v1 finale'}, format='json').status_code == 200

    def test_an_invalid_transition_is_refused(self):
        _client, _user, adv, _adv_user, promoter, reservation_id = _reservation_with()
        contract_id = adv.post(_contracts_url(reservation_id, promoter), {'content': 'v1'}, format='json').data['id']
        assert _transition(adv, contract_id, promoter, 'approve').status_code == 409
        assert _transition(adv, contract_id, promoter, 'sign').status_code == 400

    def test_only_one_version_in_progress_at_a_time(self):
        _client, _user, adv, _adv_user, promoter, reservation_id = _reservation_with()
        assert adv.post(_contracts_url(reservation_id, promoter), {'content': 'v1'}, format='json').status_code == 201
        response = adv.post(_contracts_url(reservation_id, promoter), {'content': 'v2'}, format='json')
        assert response.status_code == 409


@pytest.mark.django_db
class TestSignedContractIsImmutableT04:
    """CDC T04 — tentative de modifier une version signée : refus ; nouvelle
    version requise ; ancienne consultable."""

    def test_editing_a_signed_version_is_refused_and_a_new_version_is_required(self):
        client, _user, adv, _adv_user, promoter, reservation_id = _reservation_with()
        contract = _approved_contract(adv, promoter, reservation_id)
        client.post(reverse('my-contract-sign', args=[contract['id']]))
        edit_url = reverse('contract-admin-update', args=[contract['id']]) + f'?organization_id={promoter.id}'

        assert adv.patch(edit_url, {'content': 'falsifié'}, format='json').status_code == 409
        assert _transition(adv, contract['id'], promoter, 'back_to_draft').status_code == 409

        v2 = adv.post(_contracts_url(reservation_id, promoter), {'content': 'Avenant v2'}, format='json')
        assert v2.status_code == 201
        assert v2.data['version'] == 2

        admin_versions = adv.get(_contracts_url(reservation_id, promoter)).data
        assert [(row['version'], row['status']) for row in admin_versions] == [(1, 'signed_simulated'), (2, 'draft')]
        # L'ancienne version reste consultable par le client ; le brouillon en
        # cours, travail interne du gestionnaire, ne lui est pas montré.
        client_versions = client.get(reverse('my-contracts', args=[reservation_id])).data
        assert [(row['version'], row['status']) for row in client_versions] == [(1, 'signed_simulated')]
        assert client_versions[0]['content'] == CONTRACT_TEXT

    def test_the_database_itself_refuses_any_change_to_a_signed_version(self):
        """Même si le code applicatif était contourné (SQL direct, sous le
        contexte RLS de l'organisation), le trigger refuse."""
        client, _user, adv, _adv_user, promoter, reservation_id = _reservation_with()
        contract = _approved_contract(adv, promoter, reservation_id)
        client.post(reverse('my-contract-sign', args=[contract['id']]))
        set_rls_context(organization_id=promoter.id)

        with pytest.raises(DatabaseError, match='signée'):
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(
                        'UPDATE sales_contract_version SET status = %s WHERE id = %s', ['draft', contract['id']],
                    )
        with pytest.raises(DatabaseError, match='contenu'):
            with transaction.atomic():
                version_2 = adv.post(_contracts_url(reservation_id, promoter), {'content': 'v2'}, format='json').data
                _transition(adv, version_2['id'], promoter, 'submit')
                set_rls_context(organization_id=promoter.id)
                with connection.cursor() as cursor:
                    cursor.execute(
                        'UPDATE sales_contract_version SET content = %s WHERE id = %s', ['falsifié', version_2['id']],
                    )

        set_rls_context(organization_id=promoter.id)
        assert ContractVersion.objects.get(id=contract['id']).status == 'signed_simulated'


@pytest.mark.django_db
class TestContractSignatureRules:
    def test_the_client_cannot_sign_a_version_that_is_not_approved(self):
        client, _user, adv, _adv_user, promoter, reservation_id = _reservation_with()
        contract_id = adv.post(_contracts_url(reservation_id, promoter), {'content': 'v1'}, format='json').data['id']
        assert client.post(reverse('my-contract-sign', args=[contract_id])).status_code == 409

    def test_only_the_latest_version_is_signable(self):
        client, _user, adv, _adv_user, promoter, reservation_id = _reservation_with()
        first = _approved_contract(adv, promoter, reservation_id, 'v1')
        _approved_contract(adv, promoter, reservation_id, 'v2')

        response = client.post(reverse('my-contract-sign', args=[first['id']]))

        assert response.status_code == 409
        assert 'plus récente' in response.data['detail']

    def test_another_client_can_neither_read_nor_sign(self):
        _client, _user, adv, _adv_user, promoter, reservation_id = _reservation_with()
        intruder, _intruder_user, _intruder_org = _register()
        contract = _approved_contract(adv, promoter, reservation_id)

        assert intruder.get(reverse('my-contracts', args=[reservation_id])).status_code == 404
        assert intruder.post(reverse('my-contract-sign', args=[contract['id']])).status_code == 404

    def test_the_adv_cannot_sign_in_place_of_the_client(self):
        _client, _user, adv, _adv_user, promoter, reservation_id = _reservation_with()
        contract = _approved_contract(adv, promoter, reservation_id)
        assert adv.post(reverse('my-contract-sign', args=[contract['id']])).status_code == 404

    def test_no_contract_on_an_expired_reservation(self):
        client, _user, adv, _adv_user, promoter, reservation_id = _reservation_with()
        contract = _approved_contract(adv, promoter, reservation_id)
        _age_hold(promoter, reservation_id)

        assert client.post(reverse('my-contract-sign', args=[contract['id']])).status_code == 409
        assert adv.post(_contracts_url(reservation_id, promoter), {'content': 'v2'}, format='json').status_code == 409

    def test_an_ordinary_client_cannot_use_the_admin_contract_routes(self):
        client, _user, _adv, _adv_user, promoter, reservation_id = _reservation_with()
        assert client.get(_contracts_url(reservation_id, promoter)).status_code == 403
