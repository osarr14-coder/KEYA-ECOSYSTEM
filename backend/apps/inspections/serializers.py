from rest_framework import serializers

from apps.evidence.models import Evidence

from . import services
from .models import Inspection, InspectionOutcome, Reserve, ReserveCorrection


class InspectionSerializer(serializers.ModelSerializer):
    # `reserve` (champ direct) référence la réserve existante réexaminée par
    # une inspection de suivi. `opened_reserve` (relation inverse) est la
    # réserve NOUVELLEMENT créée par CETTE inspection si son outcome est
    # `avec_reserve` sans suivi — les deux ne sont jamais renseignés
    # ensemble. Sans ce champ, un client n'aurait aucun moyen de savoir
    # quelle réserve vient d'être ouverte par sa requête.
    opened_reserve = serializers.SerializerMethodField()
    # Audit UI R1 (K02) : toutes les réserves ouvertes par cette inspection.
    opened_reserves = serializers.SerializerMethodField()

    class Meta:
        model = Inspection
        fields = [
            'id', 'lot', 'inspector', 'work_declaration', 'evidence', 'outcome',
            'reserve', 'opened_reserve', 'opened_reserves', 'note', 'created_at', 'client_correlation_id',
            'examined_evidence_ids', 'reserve_decisions',
        ]
        read_only_fields = fields

    def get_opened_reserve(self, inspection):
        reserve_ids = self.get_opened_reserves(inspection)
        return reserve_ids[0] if reserve_ids else None

    def get_opened_reserves(self, inspection):
        # Juste après la création : identifiants transmis par le service (les
        # réserves ne sont pas lisibles sous le contexte RLS du contrôleur).
        if hasattr(inspection, 'opened_reserve_ids'):
            return inspection.opened_reserve_ids
        reserves = inspection.opened_reserves.order_by('created_at', 'id')
        return [str(reserve_id) for reserve_id in reserves.values_list('id', flat=True)]


class InspectionCreateSerializer(serializers.Serializer):
    """Pas un `ModelSerializer` : `organization`/`work_declaration`/
    `evidence`/`reserve` référencent une organisation différente de celle
    de l'inspecteur par construction (règle d'indépendance du contrôle) —
    impossible de les scoper via un queryset `PrimaryKeyRelatedField` comme
    ailleurs dans ce projet. La validation d'existence/appartenance a lieu
    dans `apps.inspections.services.create_inspection`, sous le contexte RLS
    de l'organisation cible.
    """

    organization = serializers.UUIDField()
    work_declaration = serializers.UUIDField(required=False, allow_null=True)
    evidence = serializers.UUIDField(required=False, allow_null=True)
    outcome = serializers.ChoiceField(choices=InspectionOutcome.choices)
    note = serializers.CharField(required=False, allow_blank=True, default='')
    reserve = serializers.UUIDField(required=False, allow_null=True)
    # Audit UI R1 (K01–K03) : réserves structurées, décisions explicites et
    # versions examinées — règles appliquées par `services.create_inspection`.
    reserves = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    decisions = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    examined_evidence_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, allow_null=True, default=None,
    )

    def validate(self, attrs):
        if bool(attrs.get('work_declaration')) == bool(attrs.get('evidence')):
            raise serializers.ValidationError(
                'Exactement un de work_declaration ou evidence doit être fourni.',
            )
        return attrs


class ReserveSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()

    class Meta:
        model = Reserve
        fields = [
            'id', 'lot', 'opened_by_inspection', 'description', 'motif', 'expected_action', 'status', 'status_label',
            'created_at',
        ]
        read_only_fields = fields

    status_label = serializers.SerializerMethodField()

    def get_status(self, reserve):
        return services.get_reserve_status(reserve)

    def get_status_label(self, reserve):
        return services.RESERVE_STATUS_LABELS.get(services.get_reserve_status(reserve), '')


class ReserveCorrectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReserveCorrection
        fields = ['id', 'reserve', 'evidence', 'submitted_by', 'created_at']
        read_only_fields = fields


class ReserveCorrectionCreateSerializer(serializers.Serializer):
    reserve = serializers.PrimaryKeyRelatedField(queryset=Reserve.objects.none())
    evidence = serializers.PrimaryKeyRelatedField(queryset=Evidence.objects.none())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        organization = self._active_organization()
        self.fields['reserve'].queryset = (
            Reserve.objects.filter(organization=organization) if organization else Reserve.objects.none()
        )
        self.fields['evidence'].queryset = (
            Evidence.objects.filter(organization=organization) if organization else Evidence.objects.none()
        )

    def _active_organization(self):
        request = self.context.get('request')
        return getattr(request, 'organization', None) if request else None

    def create(self, validated_data):
        request = self.context['request']
        return services.create_reserve_correction(
            organization=request.organization,
            reserve=validated_data['reserve'],
            evidence=validated_data['evidence'],
            submitted_by=request.user,
        )
