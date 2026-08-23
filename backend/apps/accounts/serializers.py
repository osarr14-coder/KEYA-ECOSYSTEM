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

# Ticket B-042 — liste blanche STRICTE des rôles qu'une inscription
# publique (`AllowAny`, `RegisterView`) peut accorder : `client` (achat
# d'un lot existant) et `sponsor` (comportement historique, programme sur
# mesure — voir `FOUNDER_ROLE_CODE` ci-dessus). Jamais `admin_keyimmo`/
# `constructeur`/`inspecteur` — ces trois rôles sont toujours rattachés
# par invitation/affectation ailleurs dans ce projet (seed admin, mission
# d'inspection, devis verrouillé), jamais par auto-inscription. Un
# `ChoiceField` (pas un `CharField` libre) refuse toute valeur hors de ce
# dict au niveau du serializer, avant même d'atteindre `create()`.
SELF_SERVICE_ROLES = {
    FOUNDER_ROLE_CODE: FOUNDER_ROLE_LABEL,
    'client': 'Client',
}


def _default_organization_name(email):
    # Ticket B-042 — un client (prospect acheteur d'un lot existant) n'a
    # aucune organisation à « fonder », contrairement au sponsor visé à
    # l'origine par ce champ (ticket 001) : ce nom n'est jamais affiché
    # comme une vraie entreprise, il existe uniquement pour que la
    # mécanique organisation/RLS déjà en place (règle non négociable,
    # CLAUDE.md — chaque requête est scopée par organisation) fonctionne
    # sans cas particulier pour un simple acheteur.
    return f'Compte personnel — {email}'


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    full_name = serializers.CharField(required=False, allow_blank=True, default='')
    # Ticket B-042 — devient optionnel : vide (cas `client`) → nom dérivé
    # automatiquement (`_default_organization_name`). Le sponsor continue
    # de nommer sa propre organisation exactement comme avant ce ticket.
    organization_name = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default='',
    )
    # Ticket B-042 — `default=FOUNDER_ROLE_CODE` (« sponsor ») préserve le
    # comportement historique de cet endpoint pour tout appelant existant
    # qui n'envoie pas ce champ (seul rôle possible avant ce ticket, voir
    # `TestRegistration`/`TestMeEndpoint`, `apps/accounts/tests.py`,
    # aucun des deux modifié par ce ticket).
    role = serializers.ChoiceField(
        choices=list(SELF_SERVICE_ROLES.items()), default=FOUNDER_ROLE_CODE,
    )

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
        organization_name = validated_data['organization_name'].strip() or _default_organization_name(user.email)
        organization = Organization.objects.create(
            name=organization_name,
            country_pack=country_pack,
        )
        role_code = validated_data['role']
        role, _ = Role.objects.get_or_create(
            code=role_code,
            defaults={'label': SELF_SERVICE_ROLES[role_code]},
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
