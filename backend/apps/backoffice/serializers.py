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
