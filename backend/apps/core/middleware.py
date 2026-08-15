from django.db import transaction
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

from apps.core.rls import set_rls_context

ORGANIZATION_HEADER = 'HTTP_X_ORGANIZATION_ID'


class OrganizationScopeMiddleware:
    """Résout l'identité JWT et l'organisation active de la requête, puis
    pose les session vars Postgres lues par les policies RLS :
    `app.current_user_id` et `app.current_organization_id`.

    Django's AuthenticationMiddleware ne résout que l'auth par session ; le
    JWT n'est normalement authentifié par DRF qu'à l'intérieur de la vue,
    trop tard pour ouvrir la transaction RLS avant l'exécution de la vue.
    On authentifie donc le JWT ici, en amont, avec la même classe que DRF
    utilisera (authentification refaite une seconde fois côté DRF, coût
    négligeable, mais aucune duplication de logique de validation).

    Les deux session vars sont posées via `set_config(..., true)`
    (équivalent de `SET LOCAL`), à l'intérieur d'un bloc `transaction.atomic()`
    qui englobe toute la requête : elles s'appliquent à la requête en cours
    et disparaissent automatiquement à la fin, qu'il y ait ou non pooling de
    connexions.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.jwt_authenticator = JWTAuthentication()

    def __call__(self, request):
        user = self._authenticate(request)
        if user is None:
            request.organization = None
            return self.get_response(request)

        with transaction.atomic():
            set_rls_context(user_id=user.id)
            organization = self._resolve_organization(request, user)
            request.organization = organization
            if organization is not None:
                set_rls_context(organization_id=organization.id)
            response = self.get_response(request)
        return response

    def _authenticate(self, request):
        try:
            result = self.jwt_authenticator.authenticate(request)
        except (InvalidToken, TokenError):
            return None
        if result is None:
            return None
        user, _validated_token = result
        request.user = user
        return user

    @staticmethod
    def _resolve_organization(request, user):
        # Import différé : apps.organizations importe apps.core dans son
        # propre code (permissions/serializers) — éviter un cycle au chargement.
        from apps.organizations.models import Membership

        requested_id = request.META.get(ORGANIZATION_HEADER)
        memberships = Membership.objects.select_related('organization').filter(
            user_id=user.id,
        )
        if requested_id:
            membership = memberships.filter(organization_id=requested_id).first()
            return membership.organization if membership else None
        membership = memberships.order_by('created_at').first()
        return membership.organization if membership else None
