from rest_framework import permissions
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmoOrGestionnaireADV, IsFinance, IsKeyimmoTeam
from apps.evidence.permissions import IsConstructeur

from . import public, services
from .models import ReservationStatus
from .permissions import IsClient
from .serializers import (
    AdminCancelSerializer,
    AllocationCreateSerializer,
    AdminReservationSerializer,
    CatalogLotSerializer,
    ClientPaymentCallSerializer,
    ContractContentSerializer,
    ContractTransitionSerializer,
    ContractVersionSerializer,
    CustomerReceiptSerializer,
    DisbursementCreateSerializer,
    DisbursementExecuteSerializer,
    DisbursementReasonSerializer,
    DisbursementSerializer,
    PaymentCallCandidateSerializer,
    PaymentCallIssueSerializer,
    PaymentCallSerializer,
    PaymentNoticeConfirmSerializer,
    PaymentNoticeDeclareSerializer,
    PaymentNoticeRejectSerializer,
    PaymentNoticeSerializer,
    ReceiptCreateSerializer,
    ReservationRequestSerializer,
    ReservationSerializer,
    balance_payload,
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


class PublicOfferView(APIView):
    """`GET /api/public/offer/` — ticket B-057. Vitrine anonyme : programmes
    avec lots disponibles et barème de paiement (simulateur). Aucune
    authentification (un jeton invalide ne doit jamais bloquer la vitrine),
    débit limité, lecture seule — voir `apps/sales/public.py`."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'public'
    throttle_classes = [ScopedRateThrottle]

    def get(self, request):
        return Response(public.public_offer())


class PublicWorksitesView(APIView):
    """`GET /api/public/worksites/` — ticket B-057. Avancement des chantiers
    en cours, jalon par jalon, sans aucune donnée client."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'public'
    throttle_classes = [ScopedRateThrottle]

    def get(self, request):
        return Response(public.public_worksites())


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
    """`GET /api/reservations/admin/?status=` — équipe KEYIMMO (admin, ADV,
    et Finance depuis B-051 : il doit trouver les dossiers à encaisser),
    toutes organisations."""

    permission_classes = [permissions.IsAuthenticated, IsKeyimmoTeam]

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


# ─── Encaissements — ticket B-051 ──────────────────────────────────────────


class FinanceFileView(APIView):
    """`GET /api/finance/reservations/{id}/?organization_id=` — dossier
    financier : appels (affecté / couvert) et encaissements (solde non
    affecté). Lecture équipe KEYIMMO."""

    permission_classes = [permissions.IsAuthenticated, IsKeyimmoTeam]

    def get(self, request, reservation_id):
        result = services.get_finance_file(
            caller_organization_id=_caller_organization_id(request),
            target_organization_id=_target_organization_id(request),
            reservation_id=reservation_id,
        )
        if result is None:
            raise NotFound()
        reservation = result['reservation']
        return Response({
            'reservation': {'id': str(reservation.id), 'status': reservation.status,
                            'status_label': reservation.get_status_display()},
            'calls': PaymentCallSerializer(result['calls'], many=True).data,
            'receipts': CustomerReceiptSerializer(result['receipts'], many=True).data,
        })


class ReceiptCreateView(APIView):
    """`POST /api/finance/reservations/{id}/receipts/?organization_id=` —
    Finance seul. 201 à la création ; 200 si la même référence est rejouée à
    l'identique (idempotence, T10) ; 409 si elle désigne un autre mouvement."""

    permission_classes = [permissions.IsAuthenticated, IsFinance]

    def post(self, request, reservation_id):
        target_organization_id = _target_organization_id(request)
        serializer = ReceiptCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            receipt, created = services.record_receipt(
                finance=request.user,
                caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id,
                reservation_id=reservation_id,
                **serializer.validated_data,
            )
        except services.ReceiptError as exc:
            return _conflict(exc)
        if receipt is None:
            raise NotFound()
        return Response(_receipt_payload(receipt), status=201 if created else 200)


class AllocationCreateView(APIView):
    """`POST /api/finance/receipts/{id}/allocations/?organization_id=` —
    Finance seul ; `{"payment_call": …, "amount": …}`."""

    permission_classes = [permissions.IsAuthenticated, IsFinance]

    def post(self, request, receipt_id):
        target_organization_id = _target_organization_id(request)
        serializer = AllocationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            allocation = services.allocate_receipt(
                finance=request.user,
                caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id,
                receipt_id=receipt_id,
                payment_call_id=serializer.validated_data['payment_call'],
                amount=serializer.validated_data['amount'],
            )
        except services.ReceiptError as exc:
            return _conflict(exc)
        if allocation is None:
            raise NotFound()
        return Response({'id': str(allocation.id), 'amount': f'{allocation.amount:.2f}'}, status=201)


class ReceiptReconcileView(APIView):
    """`POST /api/finance/receipts/{id}/reconcile/?organization_id=` —
    Finance seul. Déclenche les transitions automatiques de la réservation."""

    permission_classes = [permissions.IsAuthenticated, IsFinance]

    def post(self, request, receipt_id):
        try:
            receipt = services.reconcile_receipt(
                finance=request.user,
                caller_organization_id=_caller_organization_id(request),
                target_organization_id=_target_organization_id(request),
                receipt_id=receipt_id,
            )
        except services.ReceiptError as exc:
            return _conflict(exc)
        if receipt is None:
            raise NotFound()
        return Response(_receipt_payload(receipt))


def _receipt_payload(receipt):
    return {
        'id': str(receipt.id), 'bank_reference': receipt.bank_reference, 'amount': f'{receipt.amount:.2f}',
        'currency': receipt.currency, 'received_on': receipt.received_on.isoformat(), 'status': receipt.status,
        'status_label': receipt.get_status_display(), 'simulation': True,
    }


# ─── Décaissements — ticket B-052 ──────────────────────────────────────────


class ProgramAccountListView(APIView):
    """`GET /api/finance/accounts/` — comptes simulés des programmes (solde
    détaillé). Lecture équipe KEYIMMO."""

    permission_classes = [permissions.IsAuthenticated, IsKeyimmoTeam]

    def get(self, request):
        accounts = services.list_program_accounts(caller_organization_id=_caller_organization_id(request))
        return Response([
            {
                'organization': {'id': str(account['program'].organization_id),
                                 'name': account['program'].organization.name},
                'program': {'id': str(account['program'].id), 'name': account['program'].name},
                'balance': balance_payload(account['balance']),
            }
            for account in accounts
        ])


class ProgramAccountView(APIView):
    """`GET /api/finance/programs/{id}/account/?organization_id=` — solde,
    jalons (éligibilité technique, prestataire affecté), décaissements."""

    permission_classes = [permissions.IsAuthenticated, IsKeyimmoTeam]

    def get(self, request, program_id):
        account = services.get_program_account(
            caller_organization_id=_caller_organization_id(request),
            target_organization_id=_target_organization_id(request),
            program_id=program_id,
        )
        if account is None:
            raise NotFound()
        program = account['program']
        return Response({
            'organization': {'id': str(program.organization_id), 'name': program.organization.name},
            'program': {'id': str(program.id), 'name': program.name},
            'balance': balance_payload(account['balance']),
            'milestones': [
                {
                    'id': str(row['milestone'].id), 'code': row['milestone'].code, 'label': row['milestone'].label,
                    'order': row['milestone'].order,
                    'lot': {'id': str(row['lot'].id), 'name': row['lot'].name},
                    'beneficiary_organization': {'id': str(row['beneficiary'].id), 'name': row['beneficiary'].name},
                    'disbursable': not row['blockers'], 'blockers': row['blockers'],
                    'open_disbursement': str(row['open_disbursement'].id) if row['open_disbursement'] else None,
                }
                for row in account['milestones']
            ],
            'disbursements': DisbursementSerializer(account['disbursements'], many=True).data,
        })


def _disbursement_response(request, target_organization_id, disbursement, status=200):
    disbursement = services.load_disbursement(
        caller_organization_id=_caller_organization_id(request),
        target_organization_id=target_organization_id, disbursement_id=disbursement.id,
    )
    return Response(DisbursementSerializer(disbursement).data, status=status)


class DisbursementCreateView(APIView):
    """`POST /api/finance/disbursements/?organization_id=` — Finance seul ;
    `{"milestone": …, "amount": …}`. 201 à la création, 200 si la même
    demande est rejouée (idempotence), 409 si une autre est déjà ouverte."""

    permission_classes = [permissions.IsAuthenticated, IsFinance]

    def post(self, request):
        target_organization_id = _target_organization_id(request)
        serializer = DisbursementCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            disbursement, created = services.prepare_disbursement(
                finance=request.user, caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id,
                milestone_id=serializer.validated_data['milestone'], amount=serializer.validated_data['amount'],
            )
        except services.DisbursementError as exc:
            return _conflict(exc)
        if disbursement is None:
            raise NotFound()
        return _disbursement_response(request, target_organization_id, disbursement, status=201 if created else 200)


class DisbursementEligibilityView(APIView):
    """`POST /api/finance/disbursements/{id}/eligibility/?organization_id=` —
    DRAFT → ELIGIBLE (montant réservé) ou 409 motivé (T09)."""

    permission_classes = [permissions.IsAuthenticated, IsFinance]

    def post(self, request, disbursement_id):
        target_organization_id = _target_organization_id(request)
        try:
            disbursement = services.check_disbursement_eligibility(
                finance=request.user, caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id, disbursement_id=disbursement_id,
            )
        except services.DisbursementError as exc:
            return _conflict(exc)
        if disbursement is None:
            raise NotFound()
        return _disbursement_response(request, target_organization_id, disbursement)


class DisbursementExecuteView(APIView):
    """`POST /api/finance/disbursements/{id}/execute/?organization_id=` —
    `{"bank_reference": …, "executed_on": …}`. 201 à l'exécution, 200 si la
    même référence est rejouée (T10), 409 sinon."""

    permission_classes = [permissions.IsAuthenticated, IsFinance]

    def post(self, request, disbursement_id):
        target_organization_id = _target_organization_id(request)
        serializer = DisbursementExecuteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            disbursement, created = services.execute_disbursement(
                finance=request.user, caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id, disbursement_id=disbursement_id,
                **serializer.validated_data,
            )
        except services.DisbursementError as exc:
            return _conflict(exc)
        if disbursement is None:
            raise NotFound()
        return _disbursement_response(request, target_organization_id, disbursement, status=201 if created else 200)


class DisbursementCancelView(APIView):
    """`POST /api/finance/disbursements/{id}/cancel/?organization_id=` —
    `{"reason": …}` obligatoire ; jamais après exécution."""

    permission_classes = [permissions.IsAuthenticated, IsFinance]

    def post(self, request, disbursement_id):
        target_organization_id = _target_organization_id(request)
        serializer = DisbursementReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            disbursement = services.cancel_disbursement(
                finance=request.user, caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id, disbursement_id=disbursement_id,
                reason=serializer.validated_data['reason'],
            )
        except services.DisbursementError as exc:
            return _conflict(exc)
        if disbursement is None:
            raise NotFound()
        return _disbursement_response(request, target_organization_id, disbursement)


class DisbursementReconcileView(APIView):
    """`POST /api/finance/disbursements/{id}/reconcile/?organization_id=` —
    sans confirmation du bénéficiaire, `{"reason": "Confirmation bénéficiaire
    non reçue"}` est obligatoire (T11)."""

    permission_classes = [permissions.IsAuthenticated, IsFinance]

    def post(self, request, disbursement_id):
        target_organization_id = _target_organization_id(request)
        serializer = DisbursementReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            disbursement = services.reconcile_disbursement(
                finance=request.user, caller_organization_id=_caller_organization_id(request),
                target_organization_id=target_organization_id, disbursement_id=disbursement_id,
                reason=serializer.validated_data['reason'],
            )
        except services.DisbursementError as exc:
            return _conflict(exc)
        if disbursement is None:
            raise NotFound()
        return _disbursement_response(request, target_organization_id, disbursement)


class BeneficiaryDisbursementListView(APIView):
    """`GET /api/build/disbursements/` — sorties exécutées vers
    l'organisation du constructeur connecté."""

    permission_classes = [permissions.IsAuthenticated, IsConstructeur]

    def get(self, request):
        disbursements = services.list_disbursements_as_beneficiary(
            caller_organization_id=_caller_organization_id(request),
        )
        return Response(DisbursementSerializer(disbursements, many=True).data)


class BeneficiaryDisbursementConfirmView(APIView):
    """`POST /api/build/disbursements/{id}/confirm/` — le constructeur
    bénéficiaire confirme la réception (information, pas preuve bancaire)."""

    permission_classes = [permissions.IsAuthenticated, IsConstructeur]

    def post(self, request, disbursement_id):
        try:
            disbursement = services.confirm_disbursement_as_beneficiary(
                constructeur=request.user, caller_organization_id=_caller_organization_id(request),
                disbursement_id=disbursement_id,
            )
        except services.DisbursementError as exc:
            return _conflict(exc)
        if disbursement is None:
            raise NotFound()
        return Response(DisbursementSerializer(disbursement).data)


# ─── Validation ADV, avis de paiement — ticket B-056 ───────────────────────


class ReservationValidateView(APIView):
    """`POST /api/reservations/{id}/validate/?organization_id=` — admin et
    ADV : valide le dossier d'une réservation bloquée et émet l'appel
    « Frais » ; 409 si déjà validée, expirée ou annulée."""

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmoOrGestionnaireADV]

    def post(self, request, reservation_id):
        try:
            reservation = services.validate_reservation(
                actor=request.user, caller_organization_id=_caller_organization_id(request),
                target_organization_id=_target_organization_id(request), reservation_id=reservation_id,
            )
        except (services.ReservationTransitionError, services.PaymentCallError) as exc:
            return _conflict(exc)
        if reservation is None:
            raise NotFound()
        return Response(AdminReservationSerializer(reservation).data)


class MyPaymentNoticeCreateView(APIView):
    """`POST /api/me/payment-calls/{id}/notices/` — le client déclare son
    virement (référence, date). 201, 200 si rejouée à l'identique, 409 si un
    autre avis attend déjà, 404 pour l'appel d'un autre client."""

    permission_classes = [permissions.IsAuthenticated, IsClient]

    def post(self, request, payment_call_id):
        serializer = PaymentNoticeDeclareSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            notice, created = services.declare_payment(
                client=request.user, caller_organization_id=_caller_organization_id(request),
                payment_call_id=payment_call_id, **serializer.validated_data,
            )
        except services.PaymentNoticeError as exc:
            return _conflict(exc)
        if notice is None:
            raise NotFound()
        return Response({
            'id': str(notice.id), 'status': notice.status, 'status_label': notice.get_status_display(),
            'amount': f'{notice.amount:.2f}', 'client_reference': notice.client_reference,
        }, status=201 if created else 200)


class PaymentNoticeListView(APIView):
    """`GET /api/finance/payment-notices/?status=declared` — équipe KEYIMMO
    (défaut : avis en attente ; `status=all` pour tous)."""

    permission_classes = [permissions.IsAuthenticated, IsKeyimmoTeam]

    def get(self, request):
        status = request.query_params.get('status', 'declared')
        notices = services.list_payment_notices(
            caller_organization_id=_caller_organization_id(request), status=None if status == 'all' else status,
        )
        return Response(PaymentNoticeSerializer(notices, many=True).data)


class PaymentNoticeConfirmView(APIView):
    """`POST /api/finance/payment-notices/{id}/confirm/?organization_id=` —
    Finance seul : encaissement créé, affecté, rapproché."""

    permission_classes = [permissions.IsAuthenticated, IsFinance]

    def post(self, request, notice_id):
        serializer = PaymentNoticeConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            notice = services.confirm_payment_notice(
                finance=request.user, caller_organization_id=_caller_organization_id(request),
                target_organization_id=_target_organization_id(request), notice_id=notice_id,
                **serializer.validated_data,
            )
        except services.PaymentNoticeError as exc:
            return _conflict(exc)
        if notice is None:
            raise NotFound()
        return Response(PaymentNoticeSerializer(notice).data)


class PaymentNoticeRejectView(APIView):
    """`POST /api/finance/payment-notices/{id}/reject/?organization_id=` —
    Finance seul, motif obligatoire."""

    permission_classes = [permissions.IsAuthenticated, IsFinance]

    def post(self, request, notice_id):
        serializer = PaymentNoticeRejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            notice = services.reject_payment_notice(
                finance=request.user, caller_organization_id=_caller_organization_id(request),
                target_organization_id=_target_organization_id(request), notice_id=notice_id,
                reason=serializer.validated_data['reason'],
            )
        except services.PaymentNoticeError as exc:
            return _conflict(exc)
        if notice is None:
            raise NotFound()
        return Response(PaymentNoticeSerializer(notice).data)
