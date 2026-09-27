from rest_framework import permissions
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmoOrGestionnaireADV

from . import services
from .models import ReservationStatus
from .permissions import IsClient
from .serializers import (
    AdminCancelSerializer,
    AdminReservationSerializer,
    CatalogLotSerializer,
    ReservationRequestSerializer,
    ReservationSerializer,
)


def _caller_organization_id(request):
    return request.organization.id if request.organization else None


def _conflict(exc):
    # 409 et non 400 : la requête est valide, c'est l'ÉTAT du lot ou de la
    # réservation qui empêche l'opération (même sémantique que
    # LotAlreadyLockedError, apps/procurement).
    return Response({'detail': str(exc)}, status=409)


class CatalogLotListView(APIView):
    """`GET /api/catalog/lots/` — ticket B-048. Lots publiés (disponibles,
    prix renseigné) de toutes les organisations."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        lots = services.list_published_lots(caller_organization_id=_caller_organization_id(request))
        return Response(CatalogLotSerializer(lots, many=True).data)


class ReservationCreateView(APIView):
    """`POST /api/reservations/` — client seulement. 201 avec la réservation
    bloquée, ou 409 avec un refus explicite (lot déjà bloqué — T01)."""

    permission_classes = [permissions.IsAuthenticated, IsClient]

    def post(self, request):
        serializer = ReservationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            reservation = services.request_reservation(
                client=request.user,
                caller_organization_id=_caller_organization_id(request),
                lot_organization_id=serializer.validated_data['organization'],
                lot_id=serializer.validated_data['lot'],
            )
        except services.LotUnavailableError as exc:
            return _conflict(exc)
        return Response(ReservationSerializer(reservation).data, status=201)


class MyReservationListView(APIView):
    """`GET /api/me/reservations/` — les réservations de l'utilisateur
    courant, jamais celles d'un autre."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        reservations = services.list_client_reservations(
            client=request.user, caller_organization_id=_caller_organization_id(request),
        )
        return Response(ReservationSerializer(reservations, many=True).data)


class MyReservationCancelView(APIView):
    """`POST /api/me/reservations/{id}/cancel/` — le client annule SA
    réservation bloquée. 404 pour la réservation d'un autre (aucune fuite
    d'existence)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, reservation_id):
        try:
            reservation = services.cancel_reservation_as_client(
                client=request.user,
                caller_organization_id=_caller_organization_id(request),
                reservation_id=reservation_id,
            )
        except services.ReservationTransitionError as exc:
            return _conflict(exc)
        if reservation is None:
            raise NotFound()
        return Response(ReservationSerializer(reservation).data)


class AdminReservationListView(APIView):
    """`GET /api/reservations/admin/?status=` — admin_keyimmo et
    gestionnaire_adv, toutes organisations."""

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmoOrGestionnaireADV]

    def get(self, request):
        status = request.query_params.get('status') or None
        if status is not None and status not in ReservationStatus.values:
            raise ValidationError({'status': 'Statut inconnu.'})
        reservations = services.list_reservations_as_admin(
            caller_organization_id=_caller_organization_id(request), status=status,
        )
        return Response(AdminReservationSerializer(reservations, many=True).data)


class AdminReservationCancelView(APIView):
    """`POST /api/reservations/{id}/admin-cancel/?organization_id=` —
    annulation motivée par admin_keyimmo/gestionnaire_adv."""

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmoOrGestionnaireADV]

    def post(self, request, reservation_id):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
        serializer = AdminCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            reservation = services.cancel_reservation_as_admin(
                admin=request.user,
                caller_organization_id=_caller_organization_id(request),
                target_organization_id=organization_id,
                reservation_id=reservation_id,
                reason=serializer.validated_data['reason'],
            )
        except services.ReservationTransitionError as exc:
            return _conflict(exc)
        if reservation is None:
            raise NotFound()
        return Response(AdminReservationSerializer(reservation).data)
