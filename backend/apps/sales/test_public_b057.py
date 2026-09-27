"""Ticket B-057 — vitrine publique anonyme (page d'accueil F-079)."""
import json

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.rls import set_rls_context

from .models import Reservation, ReservationStatus
from .tests import _accept_milestone, _age_hold, _published_lot, _register, _reserve
from .views import PublicOfferView, PublicWorksitesView


# PO-2026-09-27-13 : l'offre publique nomme le constructeur (champ « constructeur », plus « promoter »).


def lot_price(promoter, lot):
    from apps.programs.models import Lot
    set_rls_context(organization_id=promoter.id)
    return str(Lot.objects.get(id=lot['id']).sale_price)


def _anonymous():
    return APIClient()


def _offer_for(program_name):
    response = _anonymous().get(reverse('public-offer'))
    assert response.status_code == 200, response.data
    return [entry for entry in response.data if entry['name'] == program_name]


@pytest.mark.django_db
class TestPublicOffer:
    def test_anonymous_visitor_sees_published_lots_grouped_by_program_with_the_payment_schedule(self):
        admin, promoter, lot = _published_lot(name='Lot P1')
        _admin_b, _promoter_b, unpriced = _published_lot(price=None, name='Lot sans prix')
        call_command('seed_demo_payment_tiers', admin_email=_register('admin_keyimmo')[1].email)

        entries = [entry for entry in _anonymous().get(reverse('public-offer')).data if entry['constructeur'] == promoter.name]

        assert len(entries) == 1
        entry = entries[0]
        assert entry['name'] == 'Résidence Démonstration'
        assert entry['locations'] == ['Abidjan']
        assert entry['available_lots'] == 1
        assert entry['total_lots'] == 1
        assert [row['name'] for row in entry['lots']] == ['Lot P1']
        assert entry['lots'][0]['surface'] == '82.00'
        assert entry['price_from'] == entry['lots'][0]['price']
        assert entry['payment_schedule']['reservation_fee'] == '100000'
        assert len(entry['payment_schedule']['steps']) > 0
        assert all('cumulative_cap_percent' in step for step in entry['payment_schedule']['steps'])
        # Un lot sans prix n'est jamais publié.
        assert all(row['id'] != unpriced['id'] for program in _anonymous().get(reverse('public-offer')).data for row in program['lots'])

    def test_a_reserved_lot_leaves_the_offer_and_no_personal_data_is_ever_exposed(self):
        client, client_user, _org = _register()
        _admin, promoter, lot = _published_lot(name='Lot réservé')
        assert _reserve(client, promoter, lot).status_code == 201

        data = _anonymous().get(reverse('public-offer')).data
        payload = json.dumps(data)

        assert lot['id'] not in payload
        assert client_user.email not in payload
        # Le programme reste affiché, « complet » (0 lot disponible sur 1).
        entry = next(entry for entry in data if entry['constructeur'] == promoter.name)
        assert entry['available_lots'] == 0
        assert entry['total_lots'] == 1
        assert entry['lots'] == []
        assert entry['price_from'] == lot_price(promoter, lot)

    def test_the_public_read_never_writes_not_even_to_release_an_expired_hold(self):
        client, _user, _org = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']
        _age_hold(promoter, reservation_id)

        _anonymous().get(reverse('public-offer'))

        set_rls_context(organization_id=promoter.id)
        assert Reservation.objects.get(id=reservation_id).status == ReservationStatus.HELD

    def test_an_invalid_bearer_token_never_blocks_the_public_page(self):
        api = _anonymous()
        api.credentials(HTTP_AUTHORIZATION='Bearer jeton-invalide')
        assert api.get(reverse('public-offer')).status_code == 200
        assert api.get(reverse('public-worksites')).status_code == 200

    def test_public_endpoints_are_rate_limited(self):
        assert PublicOfferView.throttle_scope == 'public'
        assert PublicWorksitesView.throttle_scope == 'public'


@pytest.mark.django_db
class TestPublicWorksites:
    def test_a_worksite_with_declared_milestones_is_listed_milestone_by_milestone_without_client_data(self):
        client, client_user, _org = _register()
        _admin, promoter, lot = _published_lot(name='Lot chantier')
        _reserve(client, promoter, lot)
        _accept_milestone(promoter, lot['id'], 'fondations')
        _admin_b, _promoter_b, idle = _published_lot(name='Lot sans travaux')

        rows = _anonymous().get(reverse('public-worksites')).data
        payload = json.dumps(rows)

        row = next(row for row in rows if row['lot'] == 'Lot chantier')
        assert row['program'] == 'Résidence Démonstration'
        assert row['total'] == len(row['milestones'])
        assert row['accepted'] == sum(1 for m in row['milestones'] if m['status'] == 'accepted')
        # État dérivé par le serveur (B-054), jamais recalculé : le jalon
        # déclaré et contrôlé n'est plus « non déclaré ».
        fondations = next(m for m in row['milestones'] if m['label'] == 'Fondations')
        assert fondations['status'] != 'not_declared'
        assert fondations['status_label']
        assert all(r['lot'] != 'Lot sans travaux' for r in rows)
        assert client_user.email not in payload
        assert idle['id'] not in payload
