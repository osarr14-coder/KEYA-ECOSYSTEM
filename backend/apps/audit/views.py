from django.db.models import Q
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmo
from apps.core.demo import active_demo_instance
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
        # Lot 5 (PO-2026-09-29-01) : une archive consultée restreint le
        # journal à sa période (une seule instance active à la fois).
        # PO-2026-09-30-12 : la vue courante se limite de même à la période
        # de l'instance active ; les événements antérieurs restent en base
        # (ajout seul, T16), consultables avec leur archive.
        viewed = getattr(request, 'viewed_demo_instance', None) or active_demo_instance()
        period = Q()
        if viewed is not None:
            period = Q(created_at__gte=viewed.created_at)
            if viewed.archived_at is not None:
                period &= Q(created_at__lte=viewed.archived_at)
        events = []
        try:
            for organization in Organization.objects.all():
                set_rls_context(organization_id=organization.id)
                events.extend(
                    AuditEvent.objects.filter(period).select_related('actor', 'organization').order_by('-id')[:JOURNAL_LIMIT],
                )
        finally:
            set_rls_context(organization_id=caller_organization_id)
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
