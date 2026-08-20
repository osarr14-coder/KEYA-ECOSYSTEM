from rest_framework import serializers

from .models import (
    ControlOfficeCalculationMode,
    ControlOfficeRate,
    LegalPaymentTierStep,
    LegalPaymentTierTemplate,
    PricingCanal,
    PricingConfig,
)


class PricingConfigCreateSerializer(serializers.Serializer):
    """Entrée de `POST /api/pricing/configs/` — voir
    `apps.pricing.services.create_pricing_config`.
    """

    country_pack = serializers.UUIDField()
    canal = serializers.ChoiceField(choices=PricingCanal.choices)
    rate = serializers.DecimalField(max_digits=5, decimal_places=2)


class PricingConfigSerializer(serializers.ModelSerializer):
    """Réponse — SEULE audience possible : `admin_keyimmo` (décision de
    conception, point B). Aucune variante candidate/constructeur à
    construire, contrairement à `Devis` (ticket 022) : `PricingConfig`
    n'est jamais partiellement exposé à un autre rôle, il est
    entièrement réservé ou entièrement absent.
    """

    class Meta:
        model = PricingConfig
        fields = ['id', 'country_pack', 'canal', 'rate', 'created_by', 'created_at']
        read_only_fields = fields


class LegalPaymentTierStepInputSerializer(serializers.Serializer):
    """Un palier, en entrée de `POST .../legal-payment-tier-templates/` —
    voir `apps.pricing.services.create_legal_payment_tier_template`.
    """

    order = serializers.IntegerField(min_value=1)
    code = serializers.CharField(max_length=50)
    label = serializers.CharField(max_length=100)
    cumulative_cap_percent = serializers.DecimalField(max_digits=5, decimal_places=2)
    allows_progressive_payments = serializers.BooleanField()


class LegalPaymentTierTemplateCreateSerializer(serializers.Serializer):
    """Entrée de `POST /api/pricing/legal-payment-tier-templates/` — le
    template ET ses paliers en une seule requête (un template incomplet
    n'a pas de sens intermédiaire).
    """

    country_pack = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)
    steps = LegalPaymentTierStepInputSerializer(many=True)


class LegalPaymentTierStepSerializer(serializers.ModelSerializer):
    class Meta:
        model = LegalPaymentTierStep
        fields = ['id', 'order', 'code', 'label', 'cumulative_cap_percent', 'allows_progressive_payments']
        read_only_fields = fields


class LegalPaymentTierTemplateSerializer(serializers.ModelSerializer):
    """Réponse — réservée à `admin_keyimmo` (même principe que
    `PricingConfigSerializer`, aucune variante candidate/constructeur).
    """

    steps = LegalPaymentTierStepSerializer(many=True, read_only=True)

    class Meta:
        model = LegalPaymentTierTemplate
        fields = [
            'id', 'country_pack', 'version', 'created_by', 'created_at',
            'activated_by', 'activated_at', 'steps',
        ]
        read_only_fields = fields


class ControlOfficeRateCreateSerializer(serializers.Serializer):
    """Entrée de `POST /api/pricing/control-office-rates/` — voir
    `apps.pricing.services.create_control_office_rate`. `percentage`/
    `fixed_amount` restent tous deux optionnels ICI (la vérification
    d'exclusivité selon `calculation_mode` vit dans le service, pas dans ce
    serializer — même endroit que la validation des plafonds cumulés du
    ticket B-027).
    """

    country_pack = serializers.UUIDField()
    jalon_type = serializers.CharField(max_length=50)
    calculation_mode = serializers.ChoiceField(choices=ControlOfficeCalculationMode.choices)
    percentage = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    fixed_amount = serializers.DecimalField(max_digits=16, decimal_places=2, required=False, allow_null=True)


class ControlOfficeRateSerializer(serializers.ModelSerializer):
    """Réponse — SEULE audience possible : `admin_keyimmo` (même principe
    que `PricingConfigSerializer`).
    """

    class Meta:
        model = ControlOfficeRate
        fields = [
            'id', 'country_pack', 'jalon_type', 'calculation_mode',
            'percentage', 'fixed_amount', 'created_by', 'created_at',
        ]
        read_only_fields = fields
