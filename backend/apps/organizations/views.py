from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmo

from .models import CountryPack
from .serializers import CountryPackListSerializer


class CountryPackListView(APIView):
    """`GET /api/organizations/country-packs/` — ticket B-030, réservé à
    `admin_keyimmo` (même permission `IsAdminKeyimmo` que `PricingConfig`/
    `LegalPaymentTierTemplate`, cohérence avec le reste de la
    configuration économique). Prépare la sélection d'un `country_pack_id`
    pour ces deux tickets.

    **Filtre `is_active=True` — premier usage réel de ce champ dans ce
    projet** (décision A) : les deux seules lectures existantes d'un
    `CountryPack` (`apps.pricing.services.create_pricing_config`/
    `create_legal_payment_tier_template`) résolvent par `id` uniquement,
    sans jamais vérifier ce statut — point de vigilance NON corrigé ici,
    voir `B-030-country-pack-list.md`. Trié par `label`, lisible pour un
    sélecteur.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request):
        country_packs = CountryPack.objects.filter(is_active=True).order_by('label')
        return Response(CountryPackListSerializer(country_packs, many=True).data)
