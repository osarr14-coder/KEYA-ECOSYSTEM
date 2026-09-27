from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmoOrGestionnaireADV

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

    # Audit UI R1 (R02) : donnée de référence, lue par l'admin (paliers du
    # Country Pack) et par le gestionnaire (création de programme).
    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmoOrGestionnaireADV]

    def get(self, request):
        country_packs = CountryPack.objects.filter(is_active=True).order_by('label')
        return Response(CountryPackListSerializer(country_packs, many=True).data)
