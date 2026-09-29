from django.db import transaction
from django.http import JsonResponse
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

from apps.core.rls import set_rls_context

ORGANIZATION_HEADER = 'HTTP_X_ORGANIZATION_ID'
# Lot 5 (PO-2026-09-29-01) — instance consultée (archive), par son code.
INSTANCE_VIEW_HEADER = 'HTTP_X_DEMO_INSTANCE_VIEW'
INSTANCE_VIEW_ROLES = ('admin_keyimmo', 'gestionnaire_adv')
SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')
ARCHIVE_READ_ONLY = 'Instance archivée — lecture seule : aucune modification possible.'


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
            requested_code = request.META.get(INSTANCE_VIEW_HEADER, '').strip()
            if not requested_code:
                return self.get_response(request)
            instance, refusal = self._resolve_instance_view(request, user, requested_code)
            if refusal is not None:
                return refusal
            request.viewed_demo_instance = instance
            from apps.core.demo import instance_view

            with instance_view(instance):
                response = self.get_response(request)
        return response

    @staticmethod
    def _resolve_instance_view(request, user, code):
        """Lot 5 (PO-2026-09-29-01, -02) : l'en-tête n'est accepté que pour
        l'administrateur et le gestionnaire (A6) ; une écriture sur une
        archive est refusée ici, avant toute vue."""
        from apps.core.models import DemoInstance, DemoInstanceStatus
        from apps.organizations.models import Membership

        if not Membership.objects.filter(user_id=user.id, role__code__in=INSTANCE_VIEW_ROLES).exists():
            return None, JsonResponse(
                {'detail': 'La consultation des archives est réservée à l’administrateur et au gestionnaire.'},
                status=403,
            )
        instance = DemoInstance.objects.filter(code=code).first()
        if instance is None:
            return None, JsonResponse({'detail': 'Instance inconnue.'}, status=404)
        if instance.status == DemoInstanceStatus.ARCHIVED and request.method not in SAFE_METHODS:
            return None, JsonResponse({'code': 'instance_archived', 'detail': ARCHIVE_READ_ONLY}, status=409)
        return instance, None

    def _authenticate(self, request):
        try:
            result = self.jwt_authenticator.authenticate(request)
        except (InvalidToken, TokenError, AuthenticationFailed):
            # `AuthenticationFailed` (pas seulement `InvalidToken`/`TokenError`)
            # : `JWTAuthentication.get_user` la lève pour un jeton par
            # ailleurs valide (signature/expiration OK) mais dont
            # l'utilisateur est introuvable OU `is_active=False` — piège
            # réel découvert au ticket 011 (back-office, désactivation de
            # compte) : sans cette branche, un jeton déjà émis avant une
            # désactivation provoquait une 500 non gérée ici (l'exception
            # remontait telle quelle depuis le middleware, avant même
            # d'atteindre la gestion d'exceptions de DRF), au lieu d'un 401
            # propre — DRF, lui, gère nativement cette exception dans une
            # vue, mais ce middleware s'exécute EN AMONT, hors de ce
            # mécanisme (voir docstring de la classe).
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
