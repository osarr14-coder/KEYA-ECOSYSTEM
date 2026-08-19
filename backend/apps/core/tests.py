import pytest
from django.test import Client
from django.urls import reverse


@pytest.mark.django_db
class TestCorsAllowsCustomHeaders:
    """Ticket 020 : bug réel trouvé en marge (première vérification RÉELLE en
    navigateur du header `X-Organization-Id`, ticket 019 — les tests
    unitaires frontend mockent `fetch`, donc n'exercent jamais un vrai
    préflight CORS). `django-cors-headers` n'autorise, par défaut, que ses
    `default_headers` — un header personnalisé comme `X-Organization-Id`
    (`apps.core.middleware.OrganizationScopeMiddleware`) faisait échouer le
    préflight CORS SILENCIEUSEMENT dès qu'une organisation active était
    connue côté frontend : `fetch` lève alors une erreur réseau générique,
    jamais une réponse HTTP lisible — Django lui-même ne loggait que des
    200, symptôme très trompeur en navigateur. Corrigé par
    `config/settings.py::CORS_ALLOW_HEADERS`.

    Un test Django ne peut pas prouver qu'un VRAI navigateur bloquerait la
    requête (le blocage CORS est appliqué côté navigateur, jamais côté
    serveur) — mais peut prouver que le serveur répond correctement à la
    requête de préflight (`OPTIONS` + `Access-Control-Request-Headers`) que
    tout navigateur envoie avant la vraie requête : c'est cette réponse,
    lue par le navigateur, qui détermine s'il autorise la requête réelle à
    partir.
    """

    def test_preflight_allows_x_organization_id_header(self):
        client = Client()

        response = client.options(
            reverse('me'),
            HTTP_ORIGIN='http://localhost:5174',
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='GET',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='x-organization-id',
        )

        allowed_headers = response.headers.get('Access-Control-Allow-Headers', '')
        assert 'x-organization-id' in allowed_headers.lower(), (
            f'Le préflight CORS ne liste pas x-organization-id parmi les headers '
            f'autorisés — un vrai navigateur bloquerait toute requête suivante qui le '
            f'porte, dès qu\'une organisation active est connue (ticket 019). '
            f'Access-Control-Allow-Headers reçu : {allowed_headers!r}'
        )

    def test_preflight_still_allows_authorization_header(self):
        """Non-régression : le préflight doit continuer d'autoriser
        `Authorization` (déjà utilisé par CHAQUE requête authentifiée de ce
        projet) — `CORS_ALLOW_HEADERS` étend la liste par défaut, ne la
        remplace jamais par une liste incomplète.
        """
        client = Client()

        response = client.options(
            reverse('me'),
            HTTP_ORIGIN='http://localhost:5174',
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='GET',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization',
        )

        allowed_headers = response.headers.get('Access-Control-Allow-Headers', '')
        assert 'authorization' in allowed_headers.lower()
