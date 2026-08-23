from rest_framework import serializers

from .models import (
    Asset,
    Lot,
    Milestone,
    Program,
    ProgramCost,
    ProgramCostRepartitionMethod,
    ProgramRequest,
    ProgramRequestStatus,
)


class ProgramSerializer(serializers.ModelSerializer):
    class Meta:
        model = Program
        fields = ['id', 'name', 'created_at']
        read_only_fields = ['id', 'created_at']


class ProgramAdminCreateSerializer(serializers.Serializer):
    """Entrée de `POST /api/programs/` réservée à `admin_keyimmo` (ticket
    B-039) — `organization` est l'organisation CIBLE (celle du programme),
    même principe que `ProgramCostCreateSerializer` : ne peut pas être
    dérivée après coup, `admin_keyimmo` n'étant pas forcément membre de
    cette organisation.
    """

    organization = serializers.UUIDField()
    name = serializers.CharField()


class AssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Asset
        fields = ['id', 'name', 'program', 'created_at']
        read_only_fields = ['id', 'created_at']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Un client ne doit pouvoir rattacher un Asset qu'à un Program de sa
        # propre organisation active — sinon il pourrait accrocher un bien à
        # un programme d'une autre organisation en forgeant son id, malgré
        # le filtre RLS/queryset appliqué ailleurs (défense en profondeur au
        # niveau du champ lui-même, pas seulement du queryset de la vue).
        organization = self._active_organization()
        programs = Program.objects.filter(organization=organization) if organization else Program.objects.none()
        self.fields['program'].queryset = programs

    def _active_organization(self):
        request = self.context.get('request')
        return getattr(request, 'organization', None) if request else None


class AssetAdminCreateSerializer(serializers.Serializer):
    """Ticket B-039 — même principe que `ProgramAdminCreateSerializer`,
    `program` est l'id du `Program` parent (vérifié appartenir à
    `organization` par `services.create_asset`, pas ici).
    """

    organization = serializers.UUIDField()
    program = serializers.UUIDField()
    name = serializers.CharField()
    location = serializers.CharField(required=False, allow_blank=True, default='')


class LotSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lot
        fields = [
            'id', 'name', 'asset', 'assigned_organization', 'surface',
            'commercial_status', 'sale_price', 'created_at',
        ]
        # `assigned_organization` (ticket 009, point d'ancrage PRO minimal)
        # se pose exclusivement via `LotViewSet.assign_organization`, jamais
        # par un PATCH générique ici — un seul chemin de mutation, documenté.
        # Sert désormais UNIQUEMENT à la lecture (ticket B-039 : `name`/
        # `surface` en écriture passent par `LotAdminCreateSerializer` et
        # `LotViewSet.update`, réservés à `admin_keyimmo` — ce serializer-ci
        # n'est plus utilisé en écriture générique). `commercial_status`/
        # `sale_price` (ticket B-042) suivent le même chemin — écriture
        # exclusivement via `LotViewSet.update`.
        read_only_fields = ['id', 'assigned_organization', 'created_at']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        organization = self._active_organization()
        assets = Asset.objects.filter(organization=organization) if organization else Asset.objects.none()
        self.fields['asset'].queryset = assets

    def _active_organization(self):
        request = self.context.get('request')
        return getattr(request, 'organization', None) if request else None


class LotAdminCreateSerializer(serializers.Serializer):
    """Ticket B-039 — même principe que `AssetAdminCreateSerializer`,
    `asset` est l'id de l'`Asset` parent (vérifié appartenir à
    `organization` par `services.create_lot`, pas ici).
    """

    organization = serializers.UUIDField()
    asset = serializers.UUIDField()
    name = serializers.CharField()
    surface = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, default=None)


class MilestoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Milestone
        fields = ['id', 'order', 'code', 'label', 'weight']


class LotHierarchySerializer(serializers.ModelSerializer):
    milestones = MilestoneSerializer(many=True, read_only=True)

    class Meta:
        model = Lot
        fields = ['id', 'name', 'milestones']


class AssetHierarchySerializer(serializers.ModelSerializer):
    lots = LotHierarchySerializer(many=True, read_only=True)

    class Meta:
        model = Asset
        fields = ['id', 'name', 'lots']


class ProgramHierarchySerializer(serializers.ModelSerializer):
    assets = AssetHierarchySerializer(many=True, read_only=True)

    class Meta:
        model = Program
        fields = ['id', 'name', 'assets']


class ProgramCostCreateSerializer(serializers.Serializer):
    """Entrée de `POST /api/programs/{program_id}/costs/` — `organization`
    est l'organisation du PROGRAMME (cible de la bascule RLS), même
    conséquence assumée que `DevisCreateSerializer` (ticket 022) : ne peut
    pas être dérivée après coup depuis `program_id` seul si `admin_keyimmo`
    n'est pas membre de cette organisation.
    """

    organization = serializers.UUIDField()
    foncier_total = serializers.DecimalField(max_digits=16, decimal_places=2)
    be_total = serializers.DecimalField(max_digits=16, decimal_places=2)
    repartition_method = serializers.ChoiceField(choices=ProgramCostRepartitionMethod.choices)
    justification = serializers.CharField()


class ProgramCostSerializer(serializers.ModelSerializer):
    """Réponse admin_keyimmo — seule audience possible (ticket B-033,
    décision G), même principe que `PricingConfigSerializer`.
    """

    class Meta:
        model = ProgramCost
        fields = [
            'id', 'program', 'organization', 'foncier_total', 'be_total',
            'repartition_method', 'justification', 'created_by', 'created_at',
        ]
        read_only_fields = fields


class LotRepartitionSerializer(serializers.Serializer):
    """Une ligne de `GET /api/programs/{program_id}/costs/repartition/` —
    liste indexée par lot, JAMAIS un objet agrégé (décision D, précision
    explicite de l'utilisateur).
    """

    lot_id = serializers.UUIDField(source='lot.id')
    foncier_lot = serializers.DecimalField(max_digits=16, decimal_places=2)
    be_lot = serializers.DecimalField(max_digits=16, decimal_places=2)


class ProgramRequestCreateSerializer(serializers.Serializer):
    """Entrée de `POST /api/programs/requests/` — `organization` n'est
    JAMAIS fournie ici, contrairement à `ProgramAdminCreateSerializer` :
    l'organisation cible est TOUJOURS celle de l'appelant
    (`request.organization`), pas un paramètre libre (voir
    `apps.programs.views.ProgramRequestListCreateView.post`)."""

    description = serializers.CharField()


class ProgramRequestDecisionSerializer(serializers.Serializer):
    """Entrée de `POST /api/programs/requests/{id}/decide/` — liste
    blanche stricte (jamais `en_attente`, qui n'est qu'un état initial,
    jamais une décision)."""

    status = serializers.ChoiceField(
        choices=[ProgramRequestStatus.ACCEPTEE, ProgramRequestStatus.REFUSEE],
    )


class ProgramRequestSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    requested_by_email = serializers.CharField(source='requested_by.email', read_only=True)

    class Meta:
        model = ProgramRequest
        fields = [
            'id', 'organization', 'organization_name', 'requested_by', 'requested_by_email',
            'description', 'status', 'program', 'created_at',
        ]
        read_only_fields = fields
