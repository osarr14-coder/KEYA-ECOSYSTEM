from rest_framework import permissions
from rest_framework.exceptions import NotFound
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .serializers import MyLotSerializer


class MyLotsView(ListAPIView):
    """`GET /api/me/lots/` — les biens explicitement assignés au client
    courant (`LotClient`), jamais tous les lots de son organisation.
    """

    serializer_class = MyLotSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return services.get_client_lots(self.request.user)


class _ClientLotScopedView(APIView):
    """Base commune : résout le `Lot` demandé UNIQUEMENT via une `LotClient`
    explicite pour l'utilisateur courant — un `Lot` qui existe mais n'est
    pas assigné à ce client renvoie 404, jamais 403 (même convention que
    `apps.tasks.views.TaskViewSet` pour une ressource d'une autre
    organisation, ticket 006) : le client ne doit même pas apprendre que
    l'id existe.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_lot_or_404(self, lot_id):
        lot = services.get_client_lot_or_none(self.request.user, lot_id)
        if lot is None:
            raise NotFound('Bien introuvable.')
        return lot


class LotOverviewView(_ClientLotScopedView):
    """`GET /api/me/lots/{lot_id}/overview/` — Vue d'ensemble (ticket 008) :
    hero, progression et dernier événement notable, tous calculés côté
    backend (`apps/home/services.py`), jamais recalculés ici ni côté
    frontend.
    """

    def get(self, request, lot_id):
        lot = self.get_lot_or_404(lot_id)
        return Response(services.build_lot_overview(lot))


class LotEvidenceFeedView(_ClientLotScopedView):
    """`GET /api/me/lots/{lot_id}/evidence/` — Vue « Avancement & preuves »
    (ticket 008) : liste chronologique des `Evidence` du lot, avec statut et
    provenance déjà résolus côté backend.
    """

    def get(self, request, lot_id):
        lot = self.get_lot_or_404(lot_id)
        return Response(services.build_lot_evidence_feed(lot))
