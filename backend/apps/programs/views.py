from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.viewsets import OrganizationScopedMixin
from apps.messaging.mixins import MessageThreadMixin
from apps.organizations.models import Organization

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


class LotViewSet(MessageThreadMixin, OrganizationScopedMixin, viewsets.ModelViewSet):
    queryset = Lot.objects.all()
    serializer_class = LotSerializer

    def perform_create(self, serializer):
        super().perform_create(serializer)
        instantiate_milestones_for_lot(serializer.instance)

    @action(detail=True, methods=['post'])
    def assign_organization(self, request, pk=None):
        """Ticket 009 (BUILD Control Tower) — point d'ancrage MINIMAL pour un
        futur module PRO (voir `Lot.assigned_organization`) : pose
        l'organisation constructrice responsable de ce lot, sans flux de
        candidature/opportunité. Accepte explicitement `organization_id`
        dans le corps plutôt que d'auto-affecter systématiquement
        l'organisation active — un futur ticket PRO pourra réutiliser cet
        endpoint tel quel pour affecter une organisation tierce, sans le
        redéfinir. `get_object()` applique déjà le filtre par organisation
        active du ViewSet (le lot lui-même reste dans le périmètre RLS
        habituel), seule l'organisation CIBLE (celle qu'on affecte) peut
        être une autre organisation que celle-ci.
        """
        lot = self.get_object()
        organization_id = request.data.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce champ est requis.'})
        organization = Organization.objects.filter(id=organization_id).first()
        if organization is None:
            raise ValidationError({'organization_id': 'Organisation introuvable.'})

        lot.assigned_organization = organization
        lot.save(update_fields=['assigned_organization'])
        return Response(LotSerializer(lot).data)

    # Action `messages` (GET/POST) fournie par `MessageThreadMixin` — voir
    # apps/messaging/mixins.py. Aucune surcharge nécessaire ici :
    # `get_object()` du ViewSet ci-dessus EST le filtre de permission
    # complet pour un Lot (organisation active).
