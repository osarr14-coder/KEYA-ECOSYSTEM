from rest_framework import permissions
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsGestionnaireADV

from . import chronology, services


def _caller_organization_id(request):
    return request.organization.id if request.organization else None


class IndicatorsView(APIView):
    """`GET /api/pilotage/indicateurs/` — lot 4 (PO-2026-09-28-46, -66) :
    indicateurs du CDC §9.3 sur l'instance active, pour le gestionnaire
    (garde serveur)."""

    permission_classes = [permissions.IsAuthenticated, IsGestionnaireADV]

    def get(self, request):
        return Response(services.indicators(caller_organization_id=_caller_organization_id(request)))


class IndicatorSourcesView(APIView):
    """`GET /api/pilotage/indicateurs/<clé>/sources/` — les lignes qui
    fondent un indicateur. Même garde : le détail n'élargit pas les droits
    (CDC §9.3) ; les sorties ne sortent qu'en total (A3)."""

    permission_classes = [permissions.IsAuthenticated, IsGestionnaireADV]

    def get(self, request, key):
        if key not in services.INDICATOR_KEYS:
            raise NotFound()
        sources = services.collect_sources(caller_organization_id=_caller_organization_id(request))
        return Response({'key': key, 'sources': sources[key]})


class DossierChronologyView(APIView):
    """`GET /api/dossiers/<id>/chronologie/` — lot 4 (PO-2026-09-28-67) :
    chronologie du dossier et du chantier de son lot, pour le gestionnaire."""

    permission_classes = [permissions.IsAuthenticated, IsGestionnaireADV]

    def get(self, request, reservation_id):
        result = chronology.dossier_chronology(
            reservation_id=reservation_id, caller_organization_id=_caller_organization_id(request),
        )
        if result is None:
            raise NotFound()
        return Response(result)
