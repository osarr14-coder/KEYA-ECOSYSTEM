from rest_framework.permissions import BasePermission

from apps.organizations.models import Membership

CLIENT_ROLE_CODE = 'client'


class IsClient(BasePermission):
    """Ticket B-048 — seul un client demande une réservation (CDC V3 §4).
    Rôle dans N'IMPORTE LAQUELLE des memberships : un client s'inscrit avec
    une organisation personnelle, jamais celle du programme."""

    message = 'Réservé aux membres du rôle client.'

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return Membership.objects.filter(user=request.user, role__code=CLIENT_ROLE_CODE).exists()
