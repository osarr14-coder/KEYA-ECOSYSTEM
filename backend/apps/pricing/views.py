from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import permissions
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmo

from . import services
from .serializers import (
    LegalPaymentTierTemplateCreateSerializer,
    LegalPaymentTierTemplateSerializer,
    PricingConfigCreateSerializer,
    PricingConfigSerializer,
)


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
        except services.CountryPackInactiveError as exc:
            # 409, pas 400 : le corps de la requête est valide (un
            # country_pack_id qui existe réellement), c'est l'ÉTAT de ce
            # CountryPack (inactif) qui rend l'opération impossible — même
            # sémantique que LotAlreadyLockedError/NoPricingConfigError
            # (apps.procurement.views, tickets 022/026).
            return Response({'detail': str(exc)}, status=409)
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


class LegalPaymentTierTemplateCreateView(APIView):
    """`POST /api/pricing/legal-payment-tier-templates/` — ticket B-027,
    réservé à `admin_keyimmo`. Crée un template BROUILLON avec ses paliers.
    Garde de non-dépassement (paliers strictement croissants, dernier =
    100 exact) appliquée par
    `apps.pricing.services.create_legal_payment_tier_template` — 400,
    aucune ligne créée si violée.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request):
        serializer = LegalPaymentTierTemplateCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            template = services.create_legal_payment_tier_template(
                admin=request.user,
                country_pack_id=data['country_pack'],
                version=data['version'],
                steps=data['steps'],
            )
        except services.CountryPackInactiveError as exc:
            # 409, pas 400 — même raisonnement que PricingConfigCreateView
            # ci-dessus (ticket B-032).
            return Response({'detail': str(exc)}, status=409)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))

        return Response(LegalPaymentTierTemplateSerializer(template).data, status=201)


class LegalPaymentTierTemplateActivateView(APIView):
    """`POST /api/pricing/legal-payment-tier-templates/{id}/activate/` —
    ticket B-027, réservé à `admin_keyimmo`. Voir
    `apps.pricing.services.activate_legal_payment_tier_template` pour la
    garantie DB (pas seulement applicative) de « au plus un actif par
    country_pack » (décision D-bis).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request, template_id):
        try:
            template = services.activate_legal_payment_tier_template(
                admin=request.user, template_id=template_id,
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))

        return Response(LegalPaymentTierTemplateSerializer(template).data, status=200)


class LegalPaymentTierTemplateActiveView(APIView):
    """`GET /api/pricing/legal-payment-tier-templates/active/?country_pack_id=<id>`
    — ticket B-027, réservé à `admin_keyimmo`. Lit le pointeur
    `ActiveLegalPaymentTierTemplate`, jamais un tri sur `activated_at`.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request):
        country_pack_id = request.query_params.get('country_pack_id')
        if not country_pack_id:
            raise ValidationError({'country_pack_id': 'Ce paramètre de requête est requis.'})

        template = services.get_active_legal_payment_tier_template(country_pack_id)
        if template is None:
            return Response(None)
        return Response(LegalPaymentTierTemplateSerializer(template).data)


class LegalPaymentTierTemplateHistoryView(APIView):
    """`GET /api/pricing/legal-payment-tier-templates/history/?country_pack_id=<id>`
    — ticket B-027, réservé à `admin_keyimmo`. Tous les templates
    (brouillons et activés) d'un `country_pack`, ordonnés par version.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request):
        country_pack_id = request.query_params.get('country_pack_id')
        if not country_pack_id:
            raise ValidationError({'country_pack_id': 'Ce paramètre de requête est requis.'})

        history = services.get_legal_payment_tier_template_history(country_pack_id)
        return Response(LegalPaymentTierTemplateSerializer(history, many=True).data)
