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
    ces tests n'est membre — créé via l'API par le gestionnaire (audit UI R1,
    R02 : l'administrateur n'a plus aucun pouvoir métier)."""
    admin_client, _admin_user, _admin_org = _register('gestionnaire_adv')
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


# ─── Appels de fonds — ticket B-050 ────────────────────────────────────────

from apps.evidence.services import create_evidence, create_work_declaration  # noqa: E402
from apps.inspections.services import create_inspection, is_milestone_technically_accepted  # noqa: E402
from apps.programs.models import Milestone  # noqa: E402

from .models import PaymentCall  # noqa: E402


def _calls_url(reservation_id, promoter):
    return reverse('payment-call-team', args=[reservation_id]) + f'?organization_id={promoter.id}'


def _issue(api, reservation_id, promoter, kind, tier_code=''):
    return api.post(_calls_url(reservation_id, promoter), {'kind': kind, 'tier_code': tier_code}, format='json')


def _validate(api, reservation_id, promoter):
    """Ticket B-056 — l'ADV valide le dossier ; l'appel « Frais » est émis
    dans la même transaction."""
    return api.post(reverse('reservation-validate', args=[reservation_id]) + f'?organization_id={promoter.id}')


def _fee_call(api, reservation_id, promoter):
    response = _validate(api, reservation_id, promoter)
    assert response.status_code == 200, response.data
    calls = api.get(_calls_url(reservation_id, promoter)).data['calls']
    return next(call for call in calls if call['kind'] == 'frais')


def _set_reservation_status(promoter, reservation_id, status):
    """Simule l'état que les encaissements (B-051) produiront."""
    set_rls_context(organization_id=promoter.id)
    Reservation.objects.filter(id=reservation_id).update(status=status)


def _finance_scenario(seed_tiers=True):
    client, client_user, _org = _register()
    adv, _adv_user, _adv_org = _register('gestionnaire_adv')
    _admin_client, admin_user, _admin_org = _register('admin_keyimmo')
    _lot_admin, promoter, lot = _published_lot()
    reservation_id = _reserve(client, promoter, lot).data['id']
    if seed_tiers:
        call_command('seed_demo_payment_tiers', admin_email=admin_user.email)
    return client, client_user, adv, promoter, lot, reservation_id


def _accept_milestone(promoter, lot_id, code, outcome='conforme'):
    _inspector_client, inspector, inspector_org = _register('inspecteur')
    set_rls_context(organization_id=promoter.id)
    milestone = Milestone.objects.get(lot_id=lot_id, code=code)
    declaration = create_work_declaration(organization=promoter, milestone=milestone, declared_by=inspector)
    create_inspection(
        inspector=inspector, inspector_organization=inspector_org, target_organization_id=promoter.id,
        work_declaration_id=declaration.id, outcome=outcome,
        # Audit UI R1 (K02) : un avis non conforme ouvre une réserve structurée.
        reserves=[{'motif': 'Non-conformité constatée', 'expected_action': 'Corriger puis fournir une nouvelle pièce'}]
        if outcome == 'avec_reserve' else None,
    )
    set_rls_context(organization_id=promoter.id)
    return milestone, declaration, inspector


@pytest.mark.django_db
class TestPaymentCallsScenario:
    """CDC V3 §9.1 — prix 30 000 000 XOF, frais 100 000 inclus dans un
    premier versement de 3 000 000 : complément 2 900 000, jamais 3 000 000."""

    def test_fee_then_complement_never_deducting_the_fee_twice(self):
        _client, _user, adv, promoter, _lot, reservation_id = _finance_scenario()

        # Ticket B-056 — aucun appel avant la validation du dossier par l'ADV.
        before = _issue(adv, reservation_id, promoter, 'frais')
        assert before.status_code == 409
        assert 'validée par l\'ADV' in before.data['detail']
        fee = _fee_call(adv, reservation_id, promoter)
        assert fee['amount'] == '100000.00'
        assert _issue(adv, reservation_id, promoter, 'frais').status_code == 409

        blocked = _issue(adv, reservation_id, promoter, 'premier_versement')
        assert blocked.status_code == 409
        assert 'frais encaissés' in blocked.data['detail']

        _set_reservation_status(promoter, reservation_id, 'reserved')
        complement = _issue(adv, reservation_id, promoter, 'premier_versement')
        assert complement.status_code == 201
        assert complement.data['amount'] == '2900000.00'

        set_rls_context(organization_id=promoter.id)
        assert AuditEvent.objects.filter(action='payment_call.issued', object_id=complement.data['id']).exists()

    def test_the_listing_explains_why_each_next_call_is_not_yet_issuable(self):
        _client, _user, adv, promoter, _lot, reservation_id = _finance_scenario()

        data = adv.get(_calls_url(reservation_id, promoter)).data

        by_kind = {candidate['kind']: candidate for candidate in data['candidates']}
        assert by_kind['frais']['available'] is False
        assert 'validée' in by_kind['frais']['reason']
        assert by_kind['premier_versement']['available'] is False
        assert by_kind['premier_versement']['amount'] == '2900000.00'

    def test_without_an_active_legal_scale_only_the_fee_can_be_called(self):
        _client, _user, adv, promoter, _lot, reservation_id = _finance_scenario(seed_tiers=False)

        data = adv.get(_calls_url(reservation_id, promoter)).data

        assert [candidate['kind'] for candidate in data['candidates']] == ['frais']
        assert 'Aucun barème' in data['blocking_reason']


@pytest.mark.django_db
class TestVefaTierCallsFollowConstruction:
    """Garantie VEFA : aucun appel au-delà de l'avancement réel du chantier."""

    def _committed(self):
        client, user, adv, promoter, lot, reservation_id = _finance_scenario()
        _fee_call(adv, reservation_id, promoter)
        _set_reservation_status(promoter, reservation_id, 'reserved')
        _issue(adv, reservation_id, promoter, 'premier_versement')
        _set_reservation_status(promoter, reservation_id, 'committed')
        return client, adv, promoter, lot, reservation_id

    def test_a_tier_is_refused_until_its_milestone_is_technically_accepted(self):
        _client, adv, promoter, lot, reservation_id = self._committed()

        refused = _issue(adv, reservation_id, promoter, 'versement', 'fondations')
        assert refused.status_code == 409
        assert "n'est pas encore techniquement accepté" in refused.data['detail']

        _accept_milestone(promoter, lot['id'], 'fondations')
        accepted = _issue(adv, reservation_id, promoter, 'versement', 'fondations')
        assert accepted.status_code == 201, accepted.data
        # 35 % de 30 000 000 − 3 000 000 déjà appelés.
        assert accepted.data['amount'] == '7500000.00'
        assert accepted.data['cumulative_cap_percent'] == '35.00'

    def test_only_the_next_tier_in_order_can_be_called(self):
        _client, adv, promoter, lot, reservation_id = self._committed()
        _accept_milestone(promoter, lot['id'], 'gros_oeuvre')

        assert _issue(adv, reservation_id, promoter, 'versement', 'gros_oeuvre').status_code == 409

    def test_an_inspection_with_a_reserve_does_not_accept_the_milestone(self):
        _client, _adv, promoter, lot, _reservation_id = self._committed()
        milestone, _declaration, _inspector = _accept_milestone(promoter, lot['id'], 'fondations', outcome='avec_reserve')
        assert is_milestone_technically_accepted(milestone) is False

    def test_a_document_added_after_acceptance_makes_it_stale_T07(self):
        _client, _adv, promoter, lot, _reservation_id = self._committed()
        milestone, declaration, inspector = _accept_milestone(promoter, lot['id'], 'fondations')
        assert is_milestone_technically_accepted(milestone) is True

        create_evidence(organization=promoter, work_declaration=declaration, documents=[], added_by=inspector)

        assert is_milestone_technically_accepted(milestone) is False


@pytest.mark.django_db
class TestPaymentCallPermissions:
    def test_finance_reads_but_never_issues_calls(self):
        _client, _user, _adv, promoter, _lot, reservation_id = _finance_scenario()
        finance, _finance_user, _org = _register('finance')

        assert finance.get(_calls_url(reservation_id, promoter)).status_code == 200
        assert _issue(finance, reservation_id, promoter, 'frais').status_code == 403
        assert _validate(finance, reservation_id, promoter).status_code == 403

    def test_the_client_sees_his_calls_without_the_issuer_identity(self):
        client, _user, adv, promoter, _lot, reservation_id = _finance_scenario()
        _fee_call(adv, reservation_id, promoter)

        rows = client.get(reverse('my-payment-calls', args=[reservation_id])).data

        assert [(row['kind'], row['amount']) for row in rows] == [('frais', '100000.00')]
        assert 'issued_by' not in rows[0]

    def test_another_client_and_a_constructeur_see_nothing(self):
        _client, _user, adv, promoter, _lot, reservation_id = _finance_scenario()
        _fee_call(adv, reservation_id, promoter)
        intruder, _intruder_user, _org = _register()
        constructeur, _c_user, _c_org = _register('constructeur')

        assert intruder.get(reverse('my-payment-calls', args=[reservation_id])).status_code == 404
        assert constructeur.get(_calls_url(reservation_id, promoter)).status_code == 403


@pytest.mark.django_db
class TestPaymentCallIsAppendOnly:
    def test_an_issued_call_is_never_rewritten(self):
        _client, _user, adv, promoter, _lot, reservation_id = _finance_scenario()
        call_id = _fee_call(adv, reservation_id, promoter)['id']
        set_rls_context(organization_id=promoter.id)

        with connection.cursor() as cursor:
            cursor.execute('UPDATE sales_payment_call SET amount = 1 WHERE id = %s', [call_id])
            assert cursor.rowcount == 0
            cursor.execute(
                "SELECT tgname FROM pg_trigger WHERE tgrelid = 'sales_payment_call'::regclass AND NOT tgisinternal",
            )
            assert {row[0] for row in cursor.fetchall()} == {'sales_payment_call_no_update', 'sales_payment_call_no_delete'}

        assert PaymentCall.objects.get(id=call_id).amount == Decimal('100000.00')


# ─── Encaissements, affectations, transitions — ticket B-051 ──────────────

from apps.programs.models import LotClient  # noqa: E402

from .models import CustomerReceipt  # noqa: E402


def _receipt(finance, promoter, reservation_id, amount, reference=None, received_on='2026-09-28'):
    return finance.post(
        reverse('finance-receipt-create', args=[reservation_id]) + f'?organization_id={promoter.id}',
        {'bank_reference': reference or f'SIM-{_next()}', 'amount': amount, 'received_on': received_on},
        format='json',
    )


def _allocate(finance, promoter, receipt_id, call_id, amount):
    return finance.post(
        reverse('finance-allocation-create', args=[receipt_id]) + f'?organization_id={promoter.id}',
        {'payment_call': call_id, 'amount': amount}, format='json',
    )


def _reconcile(finance, promoter, receipt_id):
    return finance.post(reverse('finance-receipt-reconcile', args=[receipt_id]) + f'?organization_id={promoter.id}')


def _pay(finance, promoter, reservation_id, call_id, amount):
    receipt = _receipt(finance, promoter, reservation_id, amount).data
    assert _allocate(finance, promoter, receipt['id'], call_id, amount).status_code == 201
    assert _reconcile(finance, promoter, receipt['id']).status_code == 200
    return receipt


def _status(promoter, reservation_id):
    set_rls_context(organization_id=promoter.id)
    return Reservation.objects.get(id=reservation_id).status


def _sign(client, adv, promoter, reservation_id):
    contract = _approved_contract(adv, promoter, reservation_id)
    assert client.post(reverse('my-contract-sign', args=[contract['id']])).status_code == 200


def _sales_scenario():
    client, client_user, adv, promoter, lot, reservation_id = _finance_scenario()
    finance, _finance_user, _org = _register('finance')
    fee_call = _fee_call(adv, reservation_id, promoter)
    return client, client_user, adv, finance, promoter, lot, reservation_id, fee_call


@pytest.mark.django_db
class TestReservationLifecycleT03:
    """CDC T03 — frais 100 000 seuls → RESERVED ; complément 2 900 000
    rapproché + contrat signé → COMMITTED ; total premier versement
    3 000 000, sans double imputation."""

    def _paid_then_signed(self, sign_first):
        client, client_user, adv, finance, promoter, lot, reservation_id, fee_call = _sales_scenario()
        if sign_first:
            _sign(client, adv, promoter, reservation_id)
        _pay(finance, promoter, reservation_id, fee_call['id'], '100000.00')
        assert _status(promoter, reservation_id) == 'reserved'

        complement = _issue(adv, reservation_id, promoter, 'premier_versement').data
        _pay(finance, promoter, reservation_id, complement['id'], '2900000.00')
        if not sign_first:
            assert _status(promoter, reservation_id) == 'reserved'
            _sign(client, adv, promoter, reservation_id)
        return client, client_user, adv, finance, promoter, lot, reservation_id

    def test_payment_before_signature(self):
        client, client_user, _adv, finance, promoter, lot, reservation_id = self._paid_then_signed(sign_first=False)

        assert _status(promoter, reservation_id) == 'committed'
        set_rls_context(organization_id=promoter.id)
        assert Lot.objects.get(id=lot['id']).commercial_status == 'vendu'
        assert LotClient.objects.filter(lot_id=lot['id'], client=client_user).exists()
        calls = finance.get(reverse('finance-file', args=[reservation_id]) + f'?organization_id={promoter.id}').data['calls']
        assert sum(Decimal(call['settled_amount']) for call in calls) == Decimal('3000000.00')
        assert {call['settlement'] for call in calls} == {'settled'}

    def test_signature_before_payment(self):
        _client, _user, _adv, _finance, promoter, _lot, reservation_id = self._paid_then_signed(sign_first=True)
        assert _status(promoter, reservation_id) == 'committed'

    def test_an_allocation_without_reconciliation_does_not_advance_the_reservation(self):
        _client, _user, _adv, finance, promoter, _lot, reservation_id, fee_call = _sales_scenario()
        receipt = _receipt(finance, promoter, reservation_id, '100000.00').data
        _allocate(finance, promoter, receipt['id'], fee_call['id'], '100000.00')

        assert _status(promoter, reservation_id) == 'held'
        _reconcile(finance, promoter, receipt['id'])
        assert _status(promoter, reservation_id) == 'reserved'


@pytest.mark.django_db
class TestPartialAndExcessPaymentsT12:
    def test_a_partial_payment_does_not_settle_the_call(self):
        client, _user, _adv, finance, promoter, _lot, reservation_id, fee_call = _sales_scenario()

        _pay(finance, promoter, reservation_id, fee_call['id'], '60000.00')

        assert _status(promoter, reservation_id) == 'held'
        row = client.get(reverse('my-payment-calls', args=[reservation_id])).data[0]
        assert (row['settled_amount'], row['settlement']) == ('60000.00', 'partial')

    def test_an_excess_stays_unallocated_and_is_never_consumed_twice(self):
        _client, _user, _adv, finance, promoter, _lot, reservation_id, fee_call = _sales_scenario()
        receipt = _receipt(finance, promoter, reservation_id, '150000.00').data

        assert _allocate(finance, promoter, receipt['id'], fee_call['id'], '100000.00').status_code == 201
        over = _allocate(finance, promoter, receipt['id'], fee_call['id'], '1.00')
        assert over.status_code == 409
        assert 'aucune double imputation' in over.data['detail']
        _reconcile(finance, promoter, receipt['id'])

        file = finance.get(reverse('finance-file', args=[reservation_id]) + f'?organization_id={promoter.id}').data
        assert file['receipts'][0]['unallocated_amount'] == '50000.00'
        assert _status(promoter, reservation_id) == 'reserved'

    def test_an_allocation_can_never_exceed_the_receipt(self):
        _client, _user, adv, finance, promoter, _lot, reservation_id, fee_call = _sales_scenario()
        receipt = _receipt(finance, promoter, reservation_id, '50000.00').data
        assert _allocate(finance, promoter, receipt['id'], fee_call['id'], '60000.00').status_code == 409


@pytest.mark.django_db
class TestReceiptIdempotenceT10:
    def test_the_same_bank_reference_replayed_never_creates_a_second_movement(self):
        _client, _user, _adv, finance, promoter, _lot, reservation_id, _fee = _sales_scenario()

        first = _receipt(finance, promoter, reservation_id, '100000.00', reference='SIM-REF-1')
        replay = _receipt(finance, promoter, reservation_id, '100000.00', reference='SIM-REF-1')
        conflicting = _receipt(finance, promoter, reservation_id, '999.00', reference='SIM-REF-1')

        assert (first.status_code, replay.status_code, conflicting.status_code) == (201, 200, 409)
        assert replay.data['id'] == first.data['id']
        set_rls_context(organization_id=promoter.id)
        assert CustomerReceipt.objects.filter(bank_reference='SIM-REF-1').count() == 1


@pytest.mark.django_db(transaction=True)
class TestConcurrentAllocationsT10:
    """Deux affectations simultanées (deux vraies connexions) sur le même
    encaissement de 100 000 : jamais plus de 100 000 affectés."""

    def test_the_same_receipt_is_never_consumed_twice(self):
        with transaction.atomic():
            _client, _user, adv, finance_api, promoter, _lot, reservation_id, fee_call = _sales_scenario()
            finance_user = User.objects.get(email__startswith='finance-')
            receipt_id = _receipt(finance_api, promoter, reservation_id, '100000.00').data['id']

        barrier = threading.Barrier(2, timeout=5)
        outcomes = []
        lock = threading.Lock()

        def worker():
            try:
                barrier.wait()
                with transaction.atomic():
                    set_rls_context(user_id=finance_user.id, organization_id=promoter.id)
                    services.allocate_receipt(
                        finance=finance_user, caller_organization_id=promoter.id,
                        target_organization_id=promoter.id, receipt_id=receipt_id,
                        payment_call_id=fee_call['id'], amount=Decimal('80000.00'),
                    )
                with lock:
                    outcomes.append('allocated')
            except services.ReceiptError:
                with lock:
                    outcomes.append('refused')
            except Exception as exc:  # noqa: BLE001
                with lock:
                    outcomes.append(f'error: {exc!r}')
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)

        assert sorted(outcomes) == ['allocated', 'refused']
        with transaction.atomic():
            set_rls_context(organization_id=promoter.id)
            total = sum(a.amount for a in CustomerReceipt.objects.get(id=receipt_id).allocations.all())
            assert total == Decimal('80000.00')


@pytest.mark.django_db
class TestReceiptSuspendsExpiryAndCancellation:
    def test_a_hold_with_a_receipt_neither_expires_nor_can_be_cancelled(self):
        client, _user, _adv, finance, promoter, _lot, reservation_id, _fee = _sales_scenario()
        _receipt(finance, promoter, reservation_id, '100000.00')
        _age_hold(promoter, reservation_id)

        client.get(reverse('catalog-lot-list'))
        assert _status(promoter, reservation_id) == 'held'
        response = client.post(reverse('my-reservation-cancel', args=[reservation_id]))
        assert response.status_code == 409
        assert 'encaissement' in response.data['detail']


@pytest.mark.django_db
class TestFinancePermissionsAndImmutability:
    def test_only_finance_records_and_the_adv_only_reads(self):
        _client, _user, adv, finance, promoter, _lot, reservation_id, _fee = _sales_scenario()

        assert _receipt(adv, promoter, reservation_id, '100000.00').status_code == 403
        assert adv.get(reverse('finance-file', args=[reservation_id]) + f'?organization_id={promoter.id}').status_code == 200
        assert finance.get(reverse('reservation-admin-list')).status_code == 200

    def test_a_recorded_receipt_amount_can_never_be_changed(self):
        _client, _user, _adv, finance, promoter, _lot, reservation_id, _fee = _sales_scenario()
        receipt_id = _receipt(finance, promoter, reservation_id, '100000.00').data['id']
        set_rls_context(organization_id=promoter.id)

        with pytest.raises(DatabaseError, match='immuables'):
            with transaction.atomic():
                CustomerReceipt.objects.filter(id=receipt_id).update(amount=Decimal('1.00'))

        assert CustomerReceipt.objects.get(id=receipt_id).amount == Decimal('100000.00')


# ─── Décaissements — ticket B-052 (CDC V3 §8.2/§8.3) ─────────────────────────

from django.core.files.uploadedfile import SimpleUploadedFile  # noqa: E402

from apps.evidence.services import create_document  # noqa: E402
from conftest import ensure_senegal_milestone_template_seeded  # noqa: E402

from .models import Disbursement, DisbursementStatus  # noqa: E402

NO_CONFIRMATION = 'Confirmation bénéficiaire non reçue'


def _add_evidence(promoter, declaration, author):
    set_rls_context(organization_id=promoter.id)
    document = create_document(
        organization=promoter, owner=author,
        uploaded_file=SimpleUploadedFile('pv.pdf', f'%PDF-1.4\n% piece {_next()}\n'.encode(), content_type='application/pdf'),
        category='rapport_chantier', source='mobile_app_photo',
    )
    return create_evidence(organization=promoter, work_declaration=declaration, documents=[document], added_by=author)


def _accept_with_evidence(promoter, lot_id, code, author, outcome='conforme'):
    """Déclaration documentée puis inspectée — jalon décaissable si conforme."""
    _inspector_client, inspector, inspector_org = _register('inspecteur')
    set_rls_context(organization_id=promoter.id)
    milestone = Milestone.objects.get(lot_id=lot_id, code=code)
    declaration = create_work_declaration(organization=promoter, milestone=milestone, declared_by=author)
    _add_evidence(promoter, declaration, author)
    create_inspection(
        inspector=inspector, inspector_organization=inspector_org, target_organization_id=promoter.id,
        work_declaration_id=declaration.id, outcome=outcome,
        # Audit UI R1 (K02) : un avis non conforme ouvre une réserve structurée.
        reserves=[{'motif': 'Non-conformité constatée', 'expected_action': 'Corriger puis fournir une nouvelle pièce'}]
        if outcome == 'avec_reserve' else None,
    )
    set_rls_context(organization_id=promoter.id)
    return milestone, declaration


def _disbursement_scenario():
    """CDC §9.1 : frais 100 000 + complément 2 900 000 encaissés et rapprochés
    (compte : 3 000 000 disponibles) ; lot affecté à un constructeur tiers."""
    client, client_user, adv, finance, promoter, lot, reservation_id, fee_call = _sales_scenario()
    _pay(finance, promoter, reservation_id, fee_call['id'], '100000.00')
    complement = _issue(adv, reservation_id, promoter, 'premier_versement').data
    _pay(finance, promoter, reservation_id, complement['id'], '2900000.00')
    constructeur, constructeur_user, constructeur_org = _register('constructeur')
    set_rls_context(organization_id=promoter.id)
    Lot.objects.filter(id=lot['id']).update(assigned_organization=constructeur_org)
    program_id = Lot.objects.select_related('asset').get(id=lot['id']).asset.program_id
    return {
        'adv': adv, 'finance': finance, 'promoter': promoter, 'lot': lot, 'program_id': program_id,
        'constructeur': constructeur, 'constructeur_user': constructeur_user, 'constructeur_org': constructeur_org,
    }


def _q(promoter):
    return f'?organization_id={promoter.id}'


def _prepare(s, milestone, amount='1000000.00'):
    return s['finance'].post(
        reverse('finance-disbursement-create') + _q(s['promoter']),
        {'milestone': str(milestone.id), 'amount': amount}, format='json',
    )


def _action(s, name, disbursement_id, data=None):
    return s['finance'].post(
        reverse(f'finance-disbursement-{name}', args=[disbursement_id]) + _q(s['promoter']), data or {}, format='json',
    )


def _execute(s, disbursement_id, reference='SORTIE-001', executed_on='2026-10-01'):
    return _action(s, 'execute', disbursement_id, {'bank_reference': reference, 'executed_on': executed_on})


def _account(s, api=None):
    return (api or s['finance']).get(
        reverse('finance-program-account', args=[s['program_id']]) + _q(s['promoter']),
    )


def _executed_disbursement(s):
    milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
    disbursement = _prepare(s, milestone).data
    assert _action(s, 'eligibility', disbursement['id']).status_code == 200
    response = _execute(s, disbursement['id'])
    assert response.status_code == 201, response.data
    return milestone, response.data


@pytest.mark.django_db
class TestDisbursementScenario:
    """CDC §9.1 — 1 000 000 XOF au constructeur après acceptation, pris sur
    le disponible : 3 000 000 − 1 000 000 = 2 000 000."""

    def test_full_path_updates_the_simulated_balance(self):
        s = _disbursement_scenario()
        assert _account(s).data['balance']['available'] == '3000000.00'
        milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])

        created = _prepare(s, milestone)
        assert created.status_code == 201, created.data
        assert created.data['status'] == 'draft'
        assert created.data['beneficiary_organization']['id'] == str(s['constructeur_org'].id)
        assert created.data['simulation'] is True

        eligible = _action(s, 'eligibility', created.data['id'])
        assert eligible.status_code == 200, eligible.data
        assert eligible.data['status'] == 'eligible'
        balance = _account(s).data['balance']
        assert (balance['reserved'], balance['available']) == ('1000000.00', '2000000.00')

        executed = _execute(s, created.data['id'])
        assert executed.status_code == 201, executed.data
        assert (executed.data['status'], executed.data['flow_status']) == ('executed_sim', 'bank_executed_sim')
        assert executed.data['beneficiary_confirmation'] == 'absent'
        # Une sortie exécutée reste déduite même avant rapprochement.
        balance = _account(s).data['balance']
        assert (balance['executed'], balance['reserved'], balance['available']) == ('1000000.00', '0.00', '2000000.00')

    def test_the_account_lists_milestones_with_their_eligibility(self):
        s = _disbursement_scenario()
        _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])

        milestones = {row['code']: row for row in _account(s).data['milestones']}

        assert milestones['fondations']['disbursable'] is True
        assert milestones['gros_oeuvre']['disbursable'] is False
        assert "jalon non accepté techniquement dans sa version courante" in milestones['gros_oeuvre']['blockers']
        assert milestones['fondations']['beneficiary_organization']['id'] == str(s['constructeur_org'].id)

    def test_the_account_list_shows_the_program(self):
        s = _disbursement_scenario()
        accounts = s['finance'].get(reverse('finance-account-list')).data
        row = next(row for row in accounts if row['program']['id'] == str(s['program_id']))
        assert row['balance']['available'] == '3000000.00'


@pytest.mark.django_db
class TestDisbursementRefusalsT09:
    def test_an_open_reserve_blocks_eligibility(self):
        s = _disbursement_scenario()
        milestone, _declaration = _accept_with_evidence(
            s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'], outcome='avec_reserve',
        )
        disbursement = _prepare(s, milestone).data

        response = _action(s, 'eligibility', disbursement['id'])

        assert response.status_code == 409
        assert 'réserve ouverte sur le lot' in response.data['detail']
        assert _execute(s, disbursement['id']).status_code == 409
        set_rls_context(organization_id=s['promoter'].id)
        assert Disbursement.objects.get(id=disbursement['id']).status == DisbursementStatus.DRAFT
        assert _account(s).data['balance']['available'] == '3000000.00'

    def test_an_insufficient_balance_blocks_eligibility_and_never_goes_negative(self):
        s = _disbursement_scenario()
        milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        disbursement = _prepare(s, milestone, amount='3000001.00').data

        response = _action(s, 'eligibility', disbursement['id'])

        assert response.status_code == 409
        assert 'disponible insuffisant (3000000.00 XOF disponibles)' in response.data['detail']
        assert _account(s).data['balance']['available'] == '3000000.00'

    def test_a_declaration_without_evidence_is_not_disbursable(self):
        s = _disbursement_scenario()
        milestone, _declaration, _inspector = _accept_milestone(s['promoter'], s['lot']['id'], 'fondations')
        disbursement = _prepare(s, milestone).data

        response = _action(s, 'eligibility', disbursement['id'])

        assert response.status_code == 409
        assert 'aucune pièce justificative' in response.data['detail']

    def test_a_draft_is_never_executed_directly(self):
        s = _disbursement_scenario()
        milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        disbursement = _prepare(s, milestone).data

        assert _execute(s, disbursement['id']).status_code == 409

    def test_a_beneficiary_change_after_preparation_blocks_eligibility(self):
        s = _disbursement_scenario()
        milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        disbursement = _prepare(s, milestone).data
        set_rls_context(organization_id=s['promoter'].id)
        Lot.objects.filter(id=s['lot']['id']).update(assigned_organization=s['promoter'])

        response = _action(s, 'eligibility', disbursement['id'])

        assert response.status_code == 409
        assert 'prestataire affecté au lot a changé' in response.data['detail']


@pytest.mark.django_db
class TestLapsedAcceptanceT07:
    """Pièce ajoutée après acceptation : la demande ELIGIBLE revient à DRAFT,
    le montant est libéré, l'exécution est refusée jusqu'à nouvelle revue."""

    def test_new_evidence_sends_an_eligible_request_back_to_draft(self):
        s = _disbursement_scenario()
        milestone, declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        disbursement = _prepare(s, milestone).data
        assert _action(s, 'eligibility', disbursement['id']).status_code == 200

        _add_evidence(s['promoter'], declaration, s['constructeur_user'])

        account = _account(s).data
        assert account['balance']['reserved'] == '0.00'
        assert account['balance']['available'] == '3000000.00'
        row = next(row for row in account['disbursements'] if row['id'] == disbursement['id'])
        assert row['status'] == 'draft'
        assert _execute(s, disbursement['id']).status_code == 409
        set_rls_context(organization_id=s['promoter'].id)
        assert AuditEvent.objects.filter(object_id=disbursement['id'], action='disbursement.eligibility_lapsed').exists()

    def test_execution_rechecks_the_conditions(self):
        s = _disbursement_scenario()
        milestone, declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        disbursement = _prepare(s, milestone).data
        assert _action(s, 'eligibility', disbursement['id']).status_code == 200
        _add_evidence(s['promoter'], declaration, s['constructeur_user'])

        response = _execute(s, disbursement['id'])

        assert response.status_code == 409
        set_rls_context(organization_id=s['promoter'].id)
        assert Disbursement.objects.get(id=disbursement['id']).status == DisbursementStatus.DRAFT


@pytest.mark.django_db
class TestDisbursementIdempotenceT10:
    def test_a_replayed_preparation_returns_the_open_request(self):
        s = _disbursement_scenario()
        milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        first = _prepare(s, milestone)
        replay = _prepare(s, milestone)
        other_amount = _prepare(s, milestone, amount='500000.00')

        assert (first.status_code, replay.status_code, other_amount.status_code) == (201, 200, 409)
        assert replay.data['id'] == first.data['id']

    def test_a_replayed_execution_never_creates_a_second_outflow(self):
        s = _disbursement_scenario()
        _milestone, executed = _executed_disbursement(s)

        replay = _execute(s, executed['id'])
        other_reference = _execute(s, executed['id'], reference='SORTIE-002')

        assert replay.status_code == 200
        assert replay.data['id'] == executed['id']
        assert other_reference.status_code == 409
        assert _account(s).data['balance']['executed'] == '1000000.00'

    def test_a_reference_is_never_reused_by_another_outflow(self):
        s = _disbursement_scenario()
        _milestone, _executed = _executed_disbursement(s)
        other, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'gros_oeuvre', s['constructeur_user'])
        second = _prepare(s, other).data
        assert _action(s, 'eligibility', second['id']).status_code == 200

        assert _execute(s, second['id']).status_code == 409


@pytest.mark.django_db(transaction=True)
class TestConcurrentEligibilityT10:
    """Deux contrôles simultanés (deux vraies connexions) de 2 000 000 chacun
    sur 3 000 000 disponibles : un seul réserve, le disponible ne devient
    jamais négatif."""

    def test_two_requests_never_consume_the_same_balance(self):
        with transaction.atomic():
            # Un test transactionnel antérieur a pu vider la base, gabarit de
            # jalons semé par migration compris (garde-fou partagé, conftest).
            ensure_senegal_milestone_template_seeded()
            s = _disbursement_scenario()
            finance_user = User.objects.get(email__startswith='finance-')
            ids = []
            for code in ('fondations', 'gros_oeuvre'):
                milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], code, s['constructeur_user'])
                ids.append(_prepare(s, milestone, amount='2000000.00').data['id'])
        promoter_id = s['promoter'].id

        barrier = threading.Barrier(2, timeout=5)
        outcomes = []
        lock = threading.Lock()

        def worker(disbursement_id):
            try:
                barrier.wait()
                with transaction.atomic():
                    set_rls_context(user_id=finance_user.id, organization_id=promoter_id)
                    result = services.check_disbursement_eligibility(
                        finance=finance_user, caller_organization_id=promoter_id,
                        target_organization_id=promoter_id, disbursement_id=disbursement_id,
                    )
                with lock:
                    outcomes.append('eligible' if result is not None else 'not found')
            except services.DisbursementError:
                with lock:
                    outcomes.append('refused')
            except Exception as exc:  # noqa: BLE001
                with lock:
                    outcomes.append(f'error: {exc!r}')
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(disbursement_id,)) for disbursement_id in ids]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)

        assert sorted(outcomes) == ['eligible', 'refused']
        with transaction.atomic():
            set_rls_context(user_id=finance_user.id, organization_id=promoter_id)
            program = Lot.objects.select_related('asset__program').get(id=s['lot']['id']).asset.program
            assert services.account_balance(program)['available'] == Decimal('1000000.00')


@pytest.mark.django_db
class TestReconciliationWithoutConfirmationT11:
    def test_finance_reconciles_with_the_mandatory_reason_and_the_absence_stays_visible(self):
        s = _disbursement_scenario()
        _milestone, executed = _executed_disbursement(s)

        without_reason = _action(s, 'reconcile', executed['id'])
        other_reason = _action(s, 'reconcile', executed['id'], {'reason': 'RAS'})
        reconciled = _action(s, 'reconcile', executed['id'], {'reason': NO_CONFIRMATION})

        assert (without_reason.status_code, other_reason.status_code) == (409, 409)
        assert reconciled.status_code == 200, reconciled.data
        assert reconciled.data['flow_status'] == 'reconciled_sim'
        assert reconciled.data['beneficiary_confirmation'] == 'absent'
        assert reconciled.data['reconciliation_reason'] == NO_CONFIRMATION
        assert _action(s, 'reconcile', executed['id'], {'reason': NO_CONFIRMATION}).status_code == 409

    def test_a_late_confirmation_keeps_the_reconciliation_and_its_reason(self):
        s = _disbursement_scenario()
        _milestone, executed = _executed_disbursement(s)
        _action(s, 'reconcile', executed['id'], {'reason': NO_CONFIRMATION})

        confirmed = s['constructeur'].post(reverse('beneficiary-disbursement-confirm', args=[executed['id']]))

        assert confirmed.status_code == 200
        assert confirmed.data['flow_status'] == 'reconciled_sim'
        assert confirmed.data['beneficiary_confirmation'] == 'confirmed'
        assert confirmed.data['reconciliation_reason'] == NO_CONFIRMATION


@pytest.mark.django_db
class TestBeneficiaryConfirmation:
    def test_the_beneficiary_sees_and_confirms_its_outflow_then_finance_reconciles_without_reason(self):
        s = _disbursement_scenario()
        _milestone, executed = _executed_disbursement(s)

        listed = s['constructeur'].get(reverse('beneficiary-disbursement-list'))
        assert listed.status_code == 200
        assert [row['id'] for row in listed.data] == [executed['id']]
        assert listed.data[0]['program']['id'] == str(s['program_id'])

        confirmed = s['constructeur'].post(reverse('beneficiary-disbursement-confirm', args=[executed['id']]))
        assert confirmed.status_code == 200
        assert confirmed.data['flow_status'] == 'beneficiary_confirmed_sim'
        replay = s['constructeur'].post(reverse('beneficiary-disbursement-confirm', args=[executed['id']]))
        assert replay.status_code == 200

        reconciled = _action(s, 'reconcile', executed['id'])
        assert reconciled.status_code == 200
        assert (reconciled.data['flow_status'], reconciled.data['reconciliation_reason']) == ('reconciled_sim', '')

    def test_another_constructeur_neither_sees_nor_confirms(self):
        s = _disbursement_scenario()
        _milestone, executed = _executed_disbursement(s)
        stranger, _user, _org = _register('constructeur')

        assert stranger.get(reverse('beneficiary-disbursement-list')).data == []
        assert stranger.post(reverse('beneficiary-disbursement-confirm', args=[executed['id']])).status_code == 404

    def test_a_draft_is_invisible_to_the_beneficiary(self):
        s = _disbursement_scenario()
        milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        _prepare(s, milestone)

        assert s['constructeur'].get(reverse('beneficiary-disbursement-list')).data == []


@pytest.mark.django_db
class TestDisbursementCancellation:
    def test_cancelling_an_eligible_request_releases_its_amount(self):
        s = _disbursement_scenario()
        milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        disbursement = _prepare(s, milestone).data
        _action(s, 'eligibility', disbursement['id'])

        assert _action(s, 'cancel', disbursement['id']).status_code == 409
        cancelled = _action(s, 'cancel', disbursement['id'], {'reason': 'Montant à revoir'})

        assert cancelled.status_code == 200
        assert cancelled.data['status'] == 'cancelled'
        assert _account(s).data['balance']['available'] == '3000000.00'
        # Le jalon accepte une nouvelle demande.
        assert _prepare(s, milestone, amount='800000.00').status_code == 201

    def test_an_executed_outflow_is_never_cancelled(self):
        s = _disbursement_scenario()
        _milestone, executed = _executed_disbursement(s)

        assert _action(s, 'cancel', executed['id'], {'reason': 'Erreur'}).status_code == 409


@pytest.mark.django_db
class TestDisbursementPermissionsAndImmutability:
    def test_only_finance_acts_and_the_keyimmo_team_reads(self):
        s = _disbursement_scenario()
        milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        disbursement = _prepare(s, milestone).data

        # PO-2026-09-27-16 : comptes réservés à Finance (le gestionnaire ne les lit plus).
        assert _account(s, api=s['finance']).status_code == 200
        assert _account(s, api=s['adv']).status_code == 403
        for api in (s['adv'], s['constructeur']):
            assert api.post(
                reverse('finance-disbursement-create') + _q(s['promoter']),
                {'milestone': str(milestone.id), 'amount': '1000.00'}, format='json',
            ).status_code == 403
            assert api.post(
                reverse('finance-disbursement-eligibility', args=[disbursement['id']]) + _q(s['promoter']),
            ).status_code == 403
        assert _account(s, api=s['constructeur']).status_code == 403
        assert s['finance'].post(reverse('beneficiary-disbursement-confirm', args=[disbursement['id']])).status_code == 403

    def test_an_executed_outflow_is_immutable_and_never_deleted(self):
        s = _disbursement_scenario()
        _milestone, executed = _executed_disbursement(s)
        set_rls_context(organization_id=s['promoter'].id)

        for mutation in (
            lambda: Disbursement.objects.filter(id=executed['id']).update(amount=Decimal('1.00')),
            lambda: Disbursement.objects.filter(id=executed['id']).update(bank_reference='AUTRE'),
            lambda: Disbursement.objects.filter(id=executed['id']).update(status='cancelled'),
            lambda: Disbursement.objects.filter(id=executed['id']).update(flow_status='planned'),
        ):
            with pytest.raises(DatabaseError), transaction.atomic():
                mutation()
        # Aucune policy DELETE : la suppression n'atteint aucune ligne (le
        # trigger BEFORE DELETE couvre en plus un rôle qui contournerait la RLS).
        Disbursement.objects.filter(id=executed['id']).delete()
        assert Disbursement.objects.filter(id=executed['id']).exists()
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM pg_trigger WHERE tgname = 'sales_disbursement_guard_delete'",
            )
            assert cursor.fetchone()[0] == 1

    def test_fractional_xof_amounts_are_refused(self):
        s = _disbursement_scenario()
        milestone, _declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        assert _prepare(s, milestone, amount='1000.50').status_code == 409
