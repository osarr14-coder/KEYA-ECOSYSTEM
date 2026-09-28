from rest_framework import serializers

from apps.organizations.identity import actor_label

from .models import Litige, LitigeStatus


class LitigeSerializer(serializers.ModelSerializer):
    lot_name = serializers.CharField(source='lot.name', read_only=True)
    # PO-2026-09-28-36 : « organisation · rôle », jamais l'e-mail.
    opened_by_label = serializers.SerializerMethodField()
    resolved_by_label = serializers.SerializerMethodField()

    class Meta:
        model = Litige
        fields = [
            'id', 'organization', 'lot', 'lot_name', 'opened_by', 'opened_by_label',
            'description', 'status', 'resolution_note', 'resolved_by', 'resolved_by_label',
            'resolved_at', 'created_at',
        ]
        read_only_fields = fields

    def get_opened_by_label(self, litige):
        return actor_label(litige.opened_by)

    def get_resolved_by_label(self, litige):
        return actor_label(litige.resolved_by) if litige.resolved_by_id else None


class LitigeCreateSerializer(serializers.Serializer):
    description = serializers.CharField()


class LitigeResolveSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[LitigeStatus.RESOLU, LitigeStatus.REJETE])
    resolution_note = serializers.CharField()
