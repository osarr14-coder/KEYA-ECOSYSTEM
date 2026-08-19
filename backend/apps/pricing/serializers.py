from rest_framework import serializers

from .models import PricingCanal, PricingConfig


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
