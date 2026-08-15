from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied


class OrganizationScopedMixin:
    """Restreint queryset et création à l'organisation active de la requête
    (résolue par `apps.core.middleware.OrganizationScopeMiddleware`).

    Filtre applicatif en plus de la policy RLS, pas à sa place — la RLS
    reste le dernier rempart si ce filtre était contourné ou oublié
    ailleurs (voir CLAUDE.md, section RLS multi-tenant).
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        organization = self.request.organization
        if organization is None:
            return self.queryset.none()
        return self.queryset.filter(organization=organization)

    def perform_create(self, serializer):
        organization = self.request.organization
        if organization is None:
            raise PermissionDenied('Aucune organisation active pour cette requête.')
        serializer.save(organization=organization)
