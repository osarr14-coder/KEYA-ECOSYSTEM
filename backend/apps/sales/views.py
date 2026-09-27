from rest_framework import permissions
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmoOrGestionnaireADV, IsKeyimmoTeam

from . import services
from .models import ReservationStatus
from .permissions import IsClient
from .serializers import (
    AdminCancelSerializer,
    AdminReservationSerializer,
    CatalogLotSerializer,
    ClientPaymentCallSerializer,
    ContractContentSerializer,
    ContractTransitionSerializer,
    ContractVersionSerializer,
    PaymentCallCandidateSerializer,
    PaymentCallIssueSerializer,
    PaymentCallSerializer,
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


# ─── Contrat fictif versionné — ticket B-049 ──────────────────────────────


def _target_organization_id(request):
    organization_id = request.query_params.get('organization_id')
    if not organization_id:
        raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
    return organization_id


class AdminContractListCreateView(APIView):
    """`GET/POST /api/reservations/{id}/contracts/admin/?organization_id=` —
    versions d'une réservation, nouvelle version `DRAFT` (admin, ADV)."""

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmoOrGestionnaireADV]

    def get(self, request, reservation_id):
        contracts = services.list_contract_versions_as_admin(
            caller_organization_id=_caller_organization_id(request),
            target_organization_id=_target_organization_id(request),
            reservation_id=reservation_id,
        )
        if contracts is None:
            raise NotFound()
        return Response(ContractVersionSerializer(contracts, many=True).data)

    def post(self, request, reservation_id):
        target_organization_id = _target_organization_id(request)
        serializer = ContractContentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            contract = services.create_contract_version(
                author=request.user,
                caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id,
                reservation_id=reservation_id,
                content=serializer.validated_data['content'],
            )
        except services.ContractTransitionError as exc:
            return _conflict(exc)
        if contract is None:
            raise NotFound()
        return Response(ContractVersionSerializer(contract).data, status=201)


class AdminContractUpdateView(APIView):
    """`PATCH /api/contracts/{id}/admin/?organization_id=` — contenu d'un
    brouillon seulement (409 sinon)."""

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmoOrGestionnaireADV]

    def patch(self, request, contract_id):
        target_organization_id = _target_organization_id(request)
        serializer = ContractContentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            contract = services.update_contract_content(
                author=request.user,
                caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id,
                contract_id=contract_id,
                content=serializer.validated_data['content'],
            )
        except services.ContractTransitionError as exc:
            return _conflict(exc)
        if contract is None:
            raise NotFound()
        return Response(ContractVersionSerializer(contract).data)


class AdminContractTransitionView(APIView):
    """`POST /api/contracts/{id}/admin-transition/?organization_id=` —
    `{"action": "submit" | "back_to_draft" | "approve"}`."""

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmoOrGestionnaireADV]

    def post(self, request, contract_id):
        target_organization_id = _target_organization_id(request)
        serializer = ContractTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            contract = services.transition_contract(
                actor=request.user,
                caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id,
                contract_id=contract_id,
                action=serializer.validated_data['action'],
            )
        except services.ContractTransitionError as exc:
            return _conflict(exc)
        if contract is None:
            raise NotFound()
        return Response(ContractVersionSerializer(contract).data)


class MyContractListView(APIView):
    """`GET /api/me/reservations/{id}/contracts/` — les versions du contrat
    de SA réservation ; 404 pour celle d'un autre client."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, reservation_id):
        contracts = services.list_client_contract_versions(
            client=request.user, caller_organization_id=_caller_organization_id(request),
            reservation_id=reservation_id,
        )
        if contracts is None:
            raise NotFound()
        return Response(ContractVersionSerializer(contracts, many=True).data)


class MyContractSignView(APIView):
    """`POST /api/me/contracts/{id}/sign/` — signature SIMULÉE par le client
    de la réservation, lui seul."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, contract_id):
        try:
            contract = services.sign_contract_as_client(
                client=request.user, caller_organization_id=_caller_organization_id(request),
                contract_id=contract_id,
            )
        except services.ContractTransitionError as exc:
            return _conflict(exc)
        if contract is None:
            raise NotFound()
        return Response(ContractVersionSerializer(contract).data)


# ─── Appels de fonds — ticket B-050 ────────────────────────────────────────


class TeamPaymentCallView(APIView):
    """`GET/POST /api/reservations/{id}/payment-calls/admin/?organization_id=`.
    Lecture : équipe KEYIMMO (admin, ADV, Finance). Émission : admin et ADV
    seulement (CDC §8.1 : « le gestionnaire émet un appel ») — Finance
    enregistre les mouvements, jamais les appels."""

    def get_permissions(self):
        if self.request.method == 'POST':
            return [permissions.IsAuthenticated(), IsAdminKeyimmoOrGestionnaireADV()]
        return [permissions.IsAuthenticated(), IsKeyimmoTeam()]

    def get(self, request, reservation_id):
        result = services.list_payment_calls_as_team(
            caller_organization_id=_caller_organization_id(request),
            target_organization_id=_target_organization_id(request),
            reservation_id=reservation_id,
        )
        if result is None:
            raise NotFound()
        return Response({
            'calls': PaymentCallSerializer(result['calls'], many=True).data,
            'candidates': PaymentCallCandidateSerializer(result['candidates'], many=True).data,
            'blocking_reason': result['blocking_reason'],
        })

    def post(self, request, reservation_id):
        target_organization_id = _target_organization_id(request)
        serializer = PaymentCallIssueSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            call = services.issue_payment_call(
                actor=request.user,
                caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id,
                reservation_id=reservation_id,
                kind=serializer.validated_data['kind'],
                tier_code=serializer.validated_data['tier_code'],
            )
        except services.PaymentCallError as exc:
            return _conflict(exc)
        if call is None:
            raise NotFound()
        return Response(PaymentCallSerializer(call).data, status=201)


class MyPaymentCallListView(APIView):
    """`GET /api/me/reservations/{id}/payment-calls/` — les appels de SA
    réservation ; 404 pour celle d'un autre client."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, reservation_id):
        calls = services.list_client_payment_calls(
            client=request.user, caller_organization_id=_caller_organization_id(request),
            reservation_id=reservation_id,
        )
        if calls is None:
            raise NotFound()
        return Response(ClientPaymentCallSerializer(calls, many=True).data)
