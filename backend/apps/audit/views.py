from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmo
from apps.core.rls import set_rls_context
from apps.organizations.models import Organization

from .models import AuditEvent

JOURNAL_LIMIT = 200


class AdminJournalView(APIView):
    """`GET /api/admin/journal/` — audit UI R1 (R02, CDC R1 §4) : le journal
    des actes métier, en LECTURE SEULE pour l'administrateur de la
    démonstration. Aucune écriture exposée (GET seul) ; la table elle-même
    refuse toute modification ou suppression (triggers, migration 0002).
    Toutes organisations, du plus récent au plus ancien, `JOURNAL_LIMIT`
    événements au plus."""

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request):
        caller_organization_id = request.organization.id if request.organization else None
        events = []
        try:
            for organization in Organization.objects.all():
                set_rls_context(organization_id=organization.id)
                events.extend(
                    AuditEvent.objects.select_related('actor', 'organization').order_by('-id')[:JOURNAL_LIMIT],
                )
        finally:
            set_rls_context(organization_id=caller_organization_id)
        events.sort(key=lambda event: event.created_at, reverse=True)
        return Response([
            {
                'id': event.id,
                'created_at': event.created_at.isoformat(),
                'organization': event.organization.name,
                'actor': event.actor.email if event.actor else None,
                'action': event.action,
                'object_type': event.object_type,
                'object_id': str(event.object_id),
                'justification': event.justification,
            }
            for event in events[:JOURNAL_LIMIT]
        ])
