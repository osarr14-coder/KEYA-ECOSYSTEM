from rest_framework import serializers

from .models import Asset, Lot, Milestone, Program


class ProgramSerializer(serializers.ModelSerializer):
    class Meta:
        model = Program
        fields = ['id', 'name', 'created_at']
        read_only_fields = ['id', 'created_at']


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


class LotSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lot
        fields = ['id', 'name', 'asset', 'created_at']
        read_only_fields = ['id', 'created_at']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        organization = self._active_organization()
        assets = Asset.objects.filter(organization=organization) if organization else Asset.objects.none()
        self.fields['asset'].queryset = assets

    def _active_organization(self):
        request = self.context.get('request')
        return getattr(request, 'organization', None) if request else None


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
