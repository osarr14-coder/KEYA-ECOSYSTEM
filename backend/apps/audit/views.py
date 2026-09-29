from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmo
from apps.core.rls import set_rls_context
from apps.organizations.models import Organization

from .models import AuditEvent
from apps.organizations.identity import actor_label
from apps.pilotage.chronology import audit_label

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
        # Lot 5 (PO-2026-09-29-01) : une archive consultée restreint le
        # journal à sa période (une seule instance active à la fois).
        viewed = getattr(request, 'viewed_demo_instance', None)
        if viewed is not None:
            end = viewed.archived_at
            events = [
                event for event in events
                if event.created_at >= viewed.created_at and (end is None or event.created_at <= end)
            ]
        events.sort(key=lambda event: event.created_at, reverse=True)
        return Response([
            {
                'id': event.id,
                'created_at': event.created_at.isoformat(),
                'organization': event.organization.name,
                # PO-2026-09-28-22 : « organisation · rôle », jamais l'e-mail.
                'actor': actor_label(event.actor) if event.actor else None,
                'action': event.action,
                # PO-2026-09-28-67 (P17 en partie) : libellé métier.
                'action_label': audit_label(event.action),
                'object_type': event.object_type,
                'object_id': str(event.object_id),
                'justification': event.justification,
            }
            for event in events[:JOURNAL_LIMIT]
        ])
