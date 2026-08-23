from rest_framework import serializers

from .models import Litige, LitigeStatus


class LitigeSerializer(serializers.ModelSerializer):
    lot_name = serializers.CharField(source='lot.name', read_only=True)
    opened_by_email = serializers.CharField(source='opened_by.email', read_only=True)
    resolved_by_email = serializers.CharField(source='resolved_by.email', read_only=True, allow_null=True)

    class Meta:
        model = Litige
        fields = [
            'id', 'organization', 'lot', 'lot_name', 'opened_by', 'opened_by_email',
            'description', 'status', 'resolution_note', 'resolved_by', 'resolved_by_email',
            'resolved_at', 'created_at',
        ]
        read_only_fields = fields


class LitigeCreateSerializer(serializers.Serializer):
    description = serializers.CharField()


class LitigeResolveSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[LitigeStatus.RESOLU, LitigeStatus.REJETE])
    resolution_note = serializers.CharField()
