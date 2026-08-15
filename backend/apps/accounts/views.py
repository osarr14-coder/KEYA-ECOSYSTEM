from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from apps.organizations.models import Membership

from .serializers import MeSerializer, RegisterSerializer


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
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
