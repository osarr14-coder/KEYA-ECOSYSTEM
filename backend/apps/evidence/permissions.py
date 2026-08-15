from rest_framework.permissions import BasePermission

from apps.organizations.models import Membership

CONSTRUCTEUR_ROLE_CODE = 'constructeur'


class IsConstructeur(BasePermission):
    """Seul un membre avec le rôle `constructeur` de l'organisation active
    peut déclarer un travail — ticket 004, scope explicite.
    """

    message = 'Seul un membre avec le rôle constructeur peut déclarer un travail.'

    def has_permission(self, request, view):
        organization = getattr(request, 'organization', None)
        if organization is None or not request.user.is_authenticated:
            return False
        return Membership.objects.filter(
            user=request.user, organization=organization, role__code=CONSTRUCTEUR_ROLE_CODE,
        ).exists()
