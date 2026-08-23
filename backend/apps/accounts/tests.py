import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.organizations.models import Membership, Organization

from .models import User

PASSWORD = 'strongpass123'


def _register(client, email, organization_name, full_name=''):
    return client.post(
        reverse('register'),
        {
            'email': email,
            'password': PASSWORD,
            'full_name': full_name,
            'organization_name': organization_name,
        },
        format='json',
    )


def _login(client, email):
    return client.post(reverse('login'), {'email': email, 'password': PASSWORD}, format='json')


@pytest.mark.django_db
class TestRegistration:
    def test_register_creates_user_organization_and_founder_membership(self):
        client = APIClient()
        response = _register(client, 'founder@example.com', 'Ma Boite')

        assert response.status_code == 201
        assert 'access' in response.data
        assert 'refresh' in response.data

        organization = Organization.objects.get(name='Ma Boite')
        assert organization.country_pack.code == 'SN'
        assert Membership.objects.filter(
            user__email='founder@example.com',
            organization=organization,
            role__code='sponsor',
        ).exists()

    def test_duplicate_email_is_rejected(self):
        client = APIClient()
        _register(client, 'dup@example.com', 'Org 1')
        response = _register(client, 'dup@example.com', 'Org 2')

        assert response.status_code == 400
        assert Organization.objects.filter(name='Org 2').exists() is False

    def test_role_defaults_to_sponsor_when_omitted(self):
        """Ticket B-042 — comportement historique inchangé pour tout
        appelant qui n'envoie pas `role` (seul rôle possible avant ce
        ticket)."""
        client = APIClient()
        response = _register(client, 'no-role@example.com', 'Org No Role')

        assert response.status_code == 201
        assert Membership.objects.filter(
            user__email='no-role@example.com', role__code='sponsor',
        ).exists()

    def test_client_role_can_be_chosen_explicitly(self):
        client = APIClient()
        response = client.post(
            reverse('register'),
            {'email': 'buyer@example.com', 'password': PASSWORD, 'role': 'client'},
            format='json',
        )

        assert response.status_code == 201
        assert Membership.objects.filter(
            user__email='buyer@example.com', role__code='client',
        ).exists()

    def test_organization_name_is_derived_automatically_when_blank(self):
        """Ticket B-042 — un client (prospect acheteur) n'a pas
        d'organisation à nommer, contrairement au sponsor."""
        client = APIClient()
        response = client.post(
            reverse('register'),
            {'email': 'no-org-name@example.com', 'password': PASSWORD, 'role': 'client'},
            format='json',
        )

        assert response.status_code == 201
        membership = Membership.objects.get(user__email='no-org-name@example.com')
        assert membership.organization.name == 'Compte personnel — no-org-name@example.com'

    def test_a_disallowed_role_is_rejected(self):
        """Ticket B-042 — liste blanche stricte : une inscription publique
        ne doit jamais pouvoir accorder un rôle opérationnel interne."""
        client = APIClient()
        response = client.post(
            reverse('register'),
            {'email': 'escalate@example.com', 'password': PASSWORD, 'role': 'admin_keyimmo'},
            format='json',
        )

        assert response.status_code == 400
        assert not User.objects.filter(email='escalate@example.com').exists()


@pytest.mark.django_db
class TestLogin:
    def test_login_with_email_and_password_returns_tokens(self):
        client = APIClient()
        _register(client, 'login@example.com', 'Org Login')

        response = _login(client, 'login@example.com')

        assert response.status_code == 200
        assert 'access' in response.data
        assert 'refresh' in response.data

    def test_login_with_wrong_password_is_rejected(self):
        client = APIClient()
        _register(client, 'wrongpass@example.com', 'Org Wrong')

        response = client.post(
            reverse('login'),
            {'email': 'wrongpass@example.com', 'password': 'not-the-password'},
            format='json',
        )

        assert response.status_code == 401


@pytest.mark.django_db
class TestMeEndpoint:
    def test_me_returns_user_and_all_memberships(self):
        client = APIClient()
        _register(client, 'me@example.com', 'Org Me', full_name='Personne Test')
        token = _login(client, 'me@example.com').data['access']
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        response = client.get(reverse('me'))

        assert response.status_code == 200
        assert response.data['email'] == 'me@example.com'
        assert response.data['full_name'] == 'Personne Test'
        assert len(response.data['memberships']) == 1
        membership = response.data['memberships'][0]
        assert membership['organization_name'] == 'Org Me'
        assert membership['role_code'] == 'sponsor'

    def test_me_requires_authentication(self):
        client = APIClient()
        response = client.get(reverse('me'))
        assert response.status_code == 401

    def test_me_does_not_leak_another_users_membership(self):
        client_a = APIClient()
        _register(client_a, 'usera@example.com', 'Org A')
        token_a = _login(client_a, 'usera@example.com').data['access']
        client_a.credentials(HTTP_AUTHORIZATION=f'Bearer {token_a}')

        client_b = APIClient()
        _register(client_b, 'userb@example.com', 'Org B')

        response = client_a.get(reverse('me'))

        organization_names = [m['organization_name'] for m in response.data['memberships']]
        assert organization_names == ['Org A']
