from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmo
from apps.core.viewsets import OrganizationScopedMixin
from apps.messaging.mixins import MessageThreadMixin
from apps.organizations.models import Organization

from . import services
from .models import Asset, Lot, Program
from .serializers import (
    AssetAdminCreateSerializer,
    AssetSerializer,
    LotAdminCreateSerializer,
    LotRepartitionSerializer,
    LotSerializer,
    ProgramAdminCreateSerializer,
    ProgramCostCreateSerializer,
    ProgramCostSerializer,
    ProgramHierarchySerializer,
    ProgramSerializer,
)


class ProgramViewSet(OrganizationScopedMixin, viewsets.ModelViewSet):
    """Ticket B-039 — KEYIMMO gatekeeper : lecture (`list`/`retrieve`/
    `hierarchy`) reste ouverte à `IsAuthenticated` + filtre par
    organisation active (`OrganizationScopedMixin`, inchangé). Écriture
    (`create`/`update`/`partial_update`/`destroy`) réservée à
    `admin_keyimmo`, avec bascule RLS explicite (`organization` fourni par
    l'appelant, jamais dérivé de `request.organization`) — même principe
    que `ProgramCostCreateView` ci-dessous, `perform_create`/`get_object`
    hérités du mixin ne conviennent plus pour ces quatre actions (voir
    B-039, section « Constat d'architecture »).
    """

    queryset = Program.objects.all()
    serializer_class = ProgramSerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [permissions.IsAuthenticated(), IsAdminKeyimmo()]
        return super().get_permissions()

    def create(self, request, *args, **kwargs):
        serializer = ProgramAdminCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            program = services.create_program(
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=data['organization'],
                name=data['name'],
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(ProgramSerializer(program).data, status=201)

    def update(self, request, *args, **kwargs):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
        name = request.data.get('name')
        if not name:
            raise ValidationError({'name': 'Ce champ est requis.'})
        try:
            program = services.update_program(
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=organization_id,
                program_id=kwargs['pk'],
                name=name,
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(ProgramSerializer(program).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
        try:
            services.delete_program(
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=organization_id,
                program_id=kwargs['pk'],
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(status=204)

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
    """Ticket B-039 — même discipline que `ProgramViewSet` ci-dessus :
    lecture ouverte (membre de l'organisation active), écriture réservée à
    `admin_keyimmo` avec organisation/programme parent fournis
    explicitement.
    """

    queryset = Asset.objects.all()
    serializer_class = AssetSerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [permissions.IsAuthenticated(), IsAdminKeyimmo()]
        return super().get_permissions()

    def create(self, request, *args, **kwargs):
        serializer = AssetAdminCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            asset = services.create_asset(
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=data['organization'],
                program_id=data['program'],
                name=data['name'],
                location=data.get('location', ''),
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(AssetSerializer(asset).data, status=201)

    def update(self, request, *args, **kwargs):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
        try:
            asset = services.update_asset(
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=organization_id,
                asset_id=kwargs['pk'],
                name=request.data.get('name'),
                location=request.data.get('location'),
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(AssetSerializer(asset).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
        try:
            services.delete_asset(
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=organization_id,
                asset_id=kwargs['pk'],
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(status=204)


class LotViewSet(MessageThreadMixin, OrganizationScopedMixin, viewsets.ModelViewSet):
    """Ticket B-039 — même discipline que `ProgramViewSet`/`AssetViewSet`
    ci-dessus. `create` appelle désormais `services.create_lot`, qui
    instancie les jalons lui-même (`instantiate_milestones_for_lot`,
    inchangé) — l'ancien `perform_create` (hérité du mixin) est retiré,
    devenu inatteignable puisque `create` est entièrement réécrit.
    """

    queryset = Lot.objects.all()
    serializer_class = LotSerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [permissions.IsAuthenticated(), IsAdminKeyimmo()]
        return super().get_permissions()

    def create(self, request, *args, **kwargs):
        serializer = LotAdminCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            lot = services.create_lot(
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=data['organization'],
                asset_id=data['asset'],
                name=data['name'],
                surface=data.get('surface'),
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(LotSerializer(lot).data, status=201)

    def update(self, request, *args, **kwargs):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
        try:
            lot = services.update_lot(
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=organization_id,
                lot_id=kwargs['pk'],
                name=request.data.get('name'),
                surface=request.data.get('surface'),
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(LotSerializer(lot).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
        try:
            services.delete_lot(
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=organization_id,
                lot_id=kwargs['pk'],
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(status=204)

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


class ProgramCostCreateView(APIView):
    """`POST /api/programs/{program_id}/costs/` — ticket B-033, réservé à
    `admin_keyimmo`. Crée une NOUVELLE révision `ProgramCost` — aucun
    endpoint `PUT`/`PATCH`/`DELETE` n'existe nulle part pour cette
    ressource (append-only, voir `apps/programs/migrations/
    0008_programcost_sequence_and_rls.py`).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request, program_id):
        serializer = ProgramCostCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            program_cost = services.create_program_cost(
                admin=request.user,
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=data['organization'],
                program_id=program_id,
                foncier_total=data['foncier_total'],
                be_total=data['be_total'],
                repartition_method=data['repartition_method'],
                justification=data['justification'],
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))

        return Response(ProgramCostSerializer(program_cost).data, status=201)


class ProgramCostCurrentView(APIView):
    """`GET /api/programs/{program_id}/costs/current/?organization_id=<id>`
    — ticket B-033, réservé à `admin_keyimmo`. Dernier `ProgramCost` créé
    pour ce programme, `null` si aucun n'existe encore.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request, program_id):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})

        program_cost = services.get_current_program_cost(
            admin_organization_id=request.organization.id if request.organization else None,
            target_organization_id=organization_id,
            program_id=program_id,
        )
        if program_cost is None:
            return Response(None)
        return Response(ProgramCostSerializer(program_cost).data)


class ProgramCostHistoryView(APIView):
    """`GET /api/programs/{program_id}/costs/history/?organization_id=<id>`
    — ticket B-033, réservé à `admin_keyimmo`. Historique COMPLET des
    révisions de ce programme, chronologique.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request, program_id):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})

        history = services.get_program_cost_history(
            admin_organization_id=request.organization.id if request.organization else None,
            target_organization_id=organization_id,
            program_id=program_id,
        )
        return Response(ProgramCostSerializer(history, many=True).data)


class ProgramCostRepartitionView(APIView):
    """`GET /api/programs/{program_id}/costs/repartition/?organization_id=<id>`
    — ticket B-033, réservé à `admin_keyimmo`. Répartition foncier/BE entre
    les lots du programme, calculée À LA VOLÉE (jamais stockée) — liste
    indexée par lot, JAMAIS un objet agrégé (décision D).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request, program_id):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})

        try:
            repartition = services.compute_lot_repartition(
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=organization_id,
                program_id=program_id,
            )
        except (services.NoProgramCostError, services.LotMissingSurfaceError) as exc:
            # 409, pas 400 : le corps de la requête est valide, c'est
            # l'ÉTAT du programme (aucun coût enregistré, ou un lot sans
            # surface pour prorata_surface) qui rend l'opération
            # impossible — même sémantique que LotAlreadyLockedError/
            # NoPricingConfigError (apps.procurement/apps.pricing).
            return Response({'detail': str(exc)}, status=409)

        return Response(LotRepartitionSerializer(repartition, many=True).data)
