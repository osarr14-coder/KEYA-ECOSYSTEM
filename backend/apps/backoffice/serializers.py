from rest_framework import serializers

from apps.accounts.models import User


class UserSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'full_name', 'is_active']
        read_only_fields = fields


class MembershipSummarySerializer(serializers.Serializer):
    organization_id = serializers.UUIDField(source='organization.id')
    organization_name = serializers.CharField(source='organization.name')
    role = serializers.CharField(source='role.code')


class UserDetailSerializer(serializers.Serializer):
    """`memberships` : une ligne par organisation dont l'utilisateur est
    membre, avec son rôle — c'est la « consultation de son organisation/
    rôle » du ticket 011, rien de plus (aucun champ ne permet de la
    MODIFIER depuis ce serializer, lecture seule).
    """

    user = UserSummarySerializer()
    memberships = MembershipSummarySerializer(many=True)


class MissionCreateSerializer(serializers.Serializer):
    """Ticket 012 — pas un `ModelSerializer` : `organization`/
    `work_declaration` référencent une organisation différente de celle de
    l'admin appelant par construction (même raison que
    `apps.inspections.serializers.InspectionCreateSerializer`) — impossible
    de les scoper via un queryset `PrimaryKeyRelatedField`. La validation
    d'existence/appartenance et la règle d'indépendance ont lieu dans
    `apps.inspections.services.create_mission`.
    """

    organization = serializers.UUIDField()
    work_declaration = serializers.UUIDField()
    assigned_inspector = serializers.UUIDField()


class MissionAdminSerializer(serializers.Serializer):
    """Vue admin d'une mission déjà créée — juste les identifiants, pas la
    traversée lot/bien/programme dont a besoin `CONTROL PWA`
    (`apps.control.serializers.MissionSerializer`, un besoin différent).
    """

    id = serializers.UUIDField()
    organization = serializers.UUIDField(source='organization_id')
    work_declaration = serializers.UUIDField(source='work_declaration_id')
    assigned_inspector = serializers.UUIDField(source='assigned_inspector_id')
    assigned_by = serializers.UUIDField(source='assigned_by_id')
    created_at = serializers.DateTimeField()
