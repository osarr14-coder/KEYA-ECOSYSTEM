from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.viewsets import OrganizationScopedMixin

from .models import Asset, Lot, Program
from .serializers import (
    AssetSerializer,
    LotSerializer,
    ProgramHierarchySerializer,
    ProgramSerializer,
)
from .services import instantiate_milestones_for_lot


class ProgramViewSet(OrganizationScopedMixin, viewsets.ModelViewSet):
    queryset = Program.objects.all()
    serializer_class = ProgramSerializer

    @action(detail=True, methods=['get'])
    def hierarchy(self, request, pk=None):
        """Hiérarchie complète Program → Assets → Lots → Milestones, pour
        alimenter BUILD (ticket 002). `get_object()` applique le même
        filtre par organisation que le reste du ViewSet.
        """
        program = self.get_object()
        serializer = ProgramHierarchySerializer(program)
        return Response(serializer.data)


class AssetViewSet(OrganizationScopedMixin, viewsets.ModelViewSet):
    queryset = Asset.objects.all()
    serializer_class = AssetSerializer


class LotViewSet(OrganizationScopedMixin, viewsets.ModelViewSet):
    queryset = Lot.objects.all()
    serializer_class = LotSerializer

    def perform_create(self, serializer):
        super().perform_create(serializer)
        instantiate_milestones_for_lot(serializer.instance)
