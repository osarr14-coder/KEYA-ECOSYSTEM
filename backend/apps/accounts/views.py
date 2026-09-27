from django.conf import settings
from rest_framework import generics, permissions, status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.organizations.models import Membership

from .serializers import MeSerializer, RegisterSerializer


class ThrottledLoginView(TokenObtainPairView):
    """Ticket B-046 (CDC §10) — `/api/auth/login/` n'avait aucune protection
    contre le bourrage d'identifiants (confirmé absent de `settings.py`
    avant ce ticket). `ScopedRateThrottle` limite par IP pour un endpoint
    anonyme (comportement standard DRF), taux fixé dans
    `DEFAULT_THROTTLE_RATES['login']` (config/settings.py) — désactivé pour
    la suite de tests (config/settings_test.py), voir ce fichier pour la
    justification. Même route/nom `login` que `TokenObtainPairView` :
    aucun changement de contrat pour les appelants.
    """

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    # Ticket B-047 — la réponse révèle si un email a déjà un compte ; sans
    # vérification d'email (aucune infrastructure d'envoi), la cacher ne
    # suffirait pas (une inscription qui réussit prouve que l'email était
    # libre) : la limite de débit est la mitigation réelle.
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'register'

    def create(self, request, *args, **kwargs):
        # Audit UI R1 (R01) : accès sur invitation uniquement (CDC §10).
        if not settings.PUBLIC_REGISTRATION_ENABLED:
            raise NotFound()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        return Response(
            {
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'user': {
                    'id': str(user.id),
                    'email': user.email,
                    'full_name': user.full_name,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class MeView(generics.GenericAPIView):
    """`GET /me` — ticket 001 : l'utilisateur, ses organisations et rôles.

    Renvoie TOUTES les memberships de l'utilisateur, pas seulement celle de
    l'organisation active de la requête — c'est la policy RLS SELECT
    (branche `user_id = current_setting('app.current_user_id')`) qui
    l'autorise, indépendamment de l'organisation résolue par le middleware.
    """

    serializer_class = MeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        memberships = Membership.objects.select_related('organization', 'role').filter(
            user_id=request.user.id,
        )
        data = {
            'id': request.user.id,
            'email': request.user.email,
            'full_name': request.user.full_name,
            'memberships': list(memberships),
        }
        serializer = self.get_serializer(data)
        return Response(serializer.data)
