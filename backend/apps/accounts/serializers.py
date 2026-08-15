from django.db import transaction
from rest_framework import serializers

from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Membership, Organization, Role

from .models import User

# Seul Country Pack du MVP — toujours créé comme donnée (get_or_create), jamais
# une constante testée directement dans la logique métier.
DEFAULT_COUNTRY_PACK_CODE = 'SN'
DEFAULT_COUNTRY_PACK_LABEL = 'Sénégal'

# Rôle attribué au fondateur d'une organisation à l'inscription : c'est lui
# qui crée les programmes immobiliers (voir ticket 002).
FOUNDER_ROLE_CODE = 'sponsor'
FOUNDER_ROLE_LABEL = 'Sponsor'


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    full_name = serializers.CharField(required=False, allow_blank=True, default='')
    organization_name = serializers.CharField(max_length=255)

    def validate_email(self, value):
        value = value.lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError('Un compte existe déjà avec cet email.')
        return value

    @transaction.atomic
    def create(self, validated_data):
        user = User.objects.create_user(
            email=validated_data['email'],
            password=validated_data['password'],
            full_name=validated_data.get('full_name', ''),
        )
        country_pack, _ = CountryPack.objects.get_or_create(
            code=DEFAULT_COUNTRY_PACK_CODE,
            defaults={'label': DEFAULT_COUNTRY_PACK_LABEL},
        )
        organization = Organization.objects.create(
            name=validated_data['organization_name'],
            country_pack=country_pack,
        )
        role, _ = Role.objects.get_or_create(
            code=FOUNDER_ROLE_CODE,
            defaults={'label': FOUNDER_ROLE_LABEL},
        )
        # Le fondateur crée sa propre organisation dans la même transaction :
        # on pose explicitement le contexte RLS sur ce user+org pour que
        # l'INSERT du Membership passe la policy (voir apps/organizations
        # migration 0002 et apps/core/middleware.py pour le cas nominal).
        set_rls_context(user_id=user.id, organization_id=organization.id)
        Membership.objects.create(user=user, organization=organization, role=role)
        return user


class MembershipSummarySerializer(serializers.Serializer):
    organization_id = serializers.UUIDField(source='organization.id')
    organization_name = serializers.CharField(source='organization.name')
    role_code = serializers.CharField(source='role.code')
    role_label = serializers.CharField(source='role.label')


class MeSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    email = serializers.EmailField()
    full_name = serializers.CharField()
    memberships = MembershipSummarySerializer(many=True)
