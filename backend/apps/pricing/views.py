from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import permissions
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmo

from . import services
from .serializers import PricingConfigCreateSerializer, PricingConfigSerializer


class PricingConfigCreateView(APIView):
    """`POST /api/pricing/configs/` — ticket 025, réservé à `admin_keyimmo`
    (point B). Crée un NOUVEAU `PricingConfig` — aucun endpoint
    `PUT`/`PATCH`/`DELETE` n'existe nulle part pour cette ressource (voir
    `apps/pricing/tests.py::TestPricingConfigNoMutationEndpointExists`).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request):
        serializer = PricingConfigCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            pricing_config = services.create_pricing_config(
                admin=request.user,
                country_pack_id=data['country_pack'],
                canal=data['canal'],
                rate=data['rate'],
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))

        return Response(PricingConfigSerializer(pricing_config).data, status=201)


class PricingConfigCurrentView(APIView):
    """`GET /api/pricing/configs/current/?country_pack_id=<id>` — ticket
    025, réservé à `admin_keyimmo`. Taux ACTUELS des deux canaux (dernier
    enregistrement par canal, `None` si aucun n'existe encore).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request):
        country_pack_id = request.query_params.get('country_pack_id')
        if not country_pack_id:
            raise ValidationError({'country_pack_id': 'Ce paramètre de requête est requis.'})

        current_rates = services.get_current_rates(country_pack_id)
        return Response({
            canal: PricingConfigSerializer(pricing_config).data if pricing_config else None
            for canal, pricing_config in current_rates.items()
        })


class PricingConfigHistoryView(APIView):
    """`GET /api/pricing/configs/history/?country_pack_id=<id>&canal=<canal>`
    — ticket 025, réservé à `admin_keyimmo`. Historique COMPLET d'un
    `(country_pack, canal)`, du plus ancien au plus récent — l'« ancien
    taux » d'un changement se lit en comparant deux entrées consécutives.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request):
        country_pack_id = request.query_params.get('country_pack_id')
        canal = request.query_params.get('canal')
        if not country_pack_id:
            raise ValidationError({'country_pack_id': 'Ce paramètre de requête est requis.'})
        if not canal:
            raise ValidationError({'canal': 'Ce paramètre de requête est requis.'})

        history = services.get_pricing_history(country_pack_id=country_pack_id, canal=canal)
        return Response(PricingConfigSerializer(history, many=True).data)
