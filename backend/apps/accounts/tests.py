import pytest
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

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


@pytest.mark.django_db
class TestLoginThrottling:
    """Ticket B-046 (CDC §10) — désactivé par défaut pour toute la suite
    (`config/settings_test.py`, `DEFAULT_THROTTLE_RATES['login'] = None`).

    `override_settings(REST_FRAMEWORK=...)` seul NE SUFFIT PAS ici : DRF fige
    `SimpleRateThrottle.THROTTLE_RATES` en attribut de CLASSE au moment de
    l'import du module `rest_framework.throttling` (`THROTTLE_RATES =
    api_settings.DEFAULT_THROTTLE_RATES`, lu une seule fois) — un
    `override_settings` en cours de test change `django.conf.settings` mais
    jamais cet attribut déjà figé. Reproduit RÉELLEMENT en écrivant ce test
    (`override_settings` seul laissait passer la 6e tentative en 200). Le
    taux est donc réactivé en patchant directement l'attribut de classe.
    `cache.clear()` est nécessaire en plus : `ScopedRateThrottle` compte via
    le cache Django (clé dérivée de l'IP pour un appelant anonyme), jamais
    réinitialisé automatiquement entre tests.
    """

    def setup_method(self):
        cache.clear()
        self._original_rates = ScopedRateThrottle.THROTTLE_RATES
        ScopedRateThrottle.THROTTLE_RATES = {'login': '5/min', 'register': None}

    def teardown_method(self):
        ScopedRateThrottle.THROTTLE_RATES = self._original_rates
        cache.clear()

    def test_sixth_login_attempt_within_a_minute_is_throttled(self):
        client = APIClient()
        _register(client, 'throttle@example.com', 'Org Throttle')

        for _ in range(5):
            response = _login(client, 'throttle@example.com')
            assert response.status_code == 200

        response = _login(client, 'throttle@example.com')
        assert response.status_code == 429

    def test_the_throttled_answer_says_how_long_to_wait(self):
        """PO-2026-09-28-45 (P32) : message explicite et délai, dans le
        corps et dans l'en-tête `Retry-After`."""
        client = APIClient()
        _register(client, 'throttle-wait@example.com', 'Org Throttle Wait')
        for _ in range(5):
            _login(client, 'throttle-wait@example.com')

        response = _login(client, 'throttle-wait@example.com')

        assert response.status_code == 429
        assert response.data['code'] == 'login_throttled'
        assert 1 <= response.data['retry_after'] <= 60
        assert response['Retry-After'] == str(response.data['retry_after'])
        assert response.data['detail'] == (
            f"Trop de tentatives de connexion depuis ce poste. Réessayez dans {response.data['retry_after']} s."
        )

    def test_throttle_counts_failed_attempts_too(self):
        """Un bourrage d'identifiants échoue systématiquement — le throttle
        doit compter CHAQUE tentative, pas seulement les connexions
        réussies, sinon il ne protège rien contre son vrai scénario
        d'attaque."""
        client = APIClient()
        _register(client, 'throttle-fail@example.com', 'Org Throttle Fail')

        for _ in range(5):
            response = client.post(
                reverse('login'),
                {'email': 'throttle-fail@example.com', 'password': 'wrong'},
                format='json',
            )
            assert response.status_code == 401

        response = client.post(
            reverse('login'),
            {'email': 'throttle-fail@example.com', 'password': 'wrong'},
            format='json',
        )
        assert response.status_code == 429

    def test_changing_x_forwarded_for_does_not_bypass_the_throttle(self):
        """Ticket B-047 — contournement reproduit par la revue de B-046 : sans
        `NUM_PROXIES`, DRF identifiait l'appelant par l'en-tête ENTIER. Ici,
        comme derrière le proxy Render, la valeur choisie par le client est
        suivie de l'adresse réelle ajoutée par le proxy : seule cette
        dernière doit compter."""
        client = APIClient()
        _register(client, 'throttle-xff@example.com', 'Org Throttle XFF')

        statuses = [
            client.post(
                reverse('login'),
                {'email': 'throttle-xff@example.com', 'password': 'wrong'},
                format='json',
                HTTP_X_FORWARDED_FOR=f'10.9.8.{attempt}, 203.0.113.7',
            ).status_code
            for attempt in range(6)
        ]

        assert statuses == [401] * 5 + [429]


@pytest.mark.django_db
class TestRegisterThrottling:
    """Ticket B-047 — même mécanique que TestLoginThrottling (voir sa
    docstring pour le patch direct de l'attribut de classe)."""

    def setup_method(self):
        cache.clear()
        self._original_rates = ScopedRateThrottle.THROTTLE_RATES
        ScopedRateThrottle.THROTTLE_RATES = {'login': None, 'register': '3/hour'}

    def teardown_method(self):
        ScopedRateThrottle.THROTTLE_RATES = self._original_rates
        cache.clear()

    def test_registration_is_rate_limited_per_ip(self):
        client = APIClient()
        statuses = [
            _register(client, f'enum-{attempt}@example.com', f'Org Enum {attempt}').status_code
            for attempt in range(4)
        ]
        assert statuses == [201, 201, 201, 429]
