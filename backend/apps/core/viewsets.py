from django.db.models import Q
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied

from apps.core.demo import demo_scope


class OrganizationScopedMixin:
    """Restreint queryset et création à l'organisation active de la requête
    (résolue par `apps.core.middleware.OrganizationScopeMiddleware`).

    Filtre applicatif en plus de la policy RLS, pas à sa place — la RLS
    reste le dernier rempart si ce filtre était contourné ou oublié
    ailleurs (voir CLAUDE.md, section RLS multi-tenant).
    """

    permission_classes = [permissions.IsAuthenticated]

    # PO-2026-09-29-12 (A6) : chemin vers le programme (ex.
    # `'milestone__lot__asset__program__'`) pour limiter la liste et le
    # détail à l'instance consultée — l'active, sauf consultation d'archive
    # autorisée (administrateur, gestionnaire). `None` : pas de filtre.
    instance_scope_prefix = None

    def instance_scope(self):
        if self.instance_scope_prefix is None:
            return Q()
        return demo_scope(self.instance_scope_prefix)

    def get_queryset(self):
        organization = self.request.organization
        if organization is None:
            return self.queryset.none()
        return self.queryset.filter(organization=organization).filter(self.instance_scope())

    def perform_create(self, serializer):
        organization = self.request.organization
        if organization is None:
            raise PermissionDenied('Aucune organisation active pour cette requête.')
        serializer.save(organization=organization)
