from rest_framework.permissions import BasePermission

from apps.organizations.models import Membership

ADMIN_KEYIMMO_ROLE_CODE = 'admin_keyimmo'


class IsAdminKeyimmo(BasePermission):
    """KEYIMMO est l'opérateur de la plateforme, pas un tenant parmi
    d'autres — contrairement à `IsInspecteur`/`IsConstructeur` (ticket 005),
    qui vérifient le rôle DANS l'organisation active de la requête, cette
    permission vérifie que l'utilisateur détient `admin_keyimmo` dans
    N'IMPORTE LAQUELLE de ses organisations : un back-office est par nature
    une capacité transverse à toutes les organisations, pas limitée à
    celle actuellement active.

    `user=request.user` (jamais un autre utilisateur) passe sans problème
    la policy RLS existante de `organizations_membership`
    (`user_id = current_user`, ticket 001) — aucun contournement
    nécessaire pour CETTE vérification précise (contrairement à la lecture
    du back-office sur un utilisateur CIBLE, voir services.py).
    """

    message = 'Réservé aux membres du rôle admin_keyimmo.'

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return Membership.objects.filter(
            user=request.user, role__code=ADMIN_KEYIMMO_ROLE_CODE,
        ).exists()
