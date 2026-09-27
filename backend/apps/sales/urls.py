from django.urls import path

from .views import (
    AdminContractListCreateView,
    AdminContractTransitionView,
    AdminContractUpdateView,
    AdminReservationCancelView,
    AdminReservationListView,
    AllocationCreateView,
    BeneficiaryDisbursementConfirmView,
    BeneficiaryDisbursementListView,
    CatalogLotListView,
    DisbursementCancelView,
    DisbursementCreateView,
    DisbursementEligibilityView,
    DisbursementExecuteView,
    DisbursementReconcileView,
    FinanceFileView,
    MyContractListView,
    MyContractSignView,
    MyPaymentCallListView,
    MyReservationCancelView,
    MyReservationListView,
    ProgramAccountListView,
    ProgramAccountView,
    ReceiptCreateView,
    ReceiptReconcileView,
    ReservationCreateView,
    TeamPaymentCallView,
)

urlpatterns = [
    path('catalog/lots/', CatalogLotListView.as_view(), name='catalog-lot-list'),
    path('reservations/', ReservationCreateView.as_view(), name='reservation-create'),
    path('reservations/admin/', AdminReservationListView.as_view(), name='reservation-admin-list'),
    path(
        'reservations/<uuid:reservation_id>/admin-cancel/',
        AdminReservationCancelView.as_view(), name='reservation-admin-cancel',
    ),
    path('me/reservations/', MyReservationListView.as_view(), name='my-reservations'),
    path(
        'me/reservations/<uuid:reservation_id>/cancel/',
        MyReservationCancelView.as_view(), name='my-reservation-cancel',
    ),
    # Ticket B-049 — contrat fictif versionné.
    path(
        'reservations/<uuid:reservation_id>/contracts/admin/',
        AdminContractListCreateView.as_view(), name='contract-admin-list-create',
    ),
    path('contracts/<uuid:contract_id>/admin/', AdminContractUpdateView.as_view(), name='contract-admin-update'),
    path(
        'contracts/<uuid:contract_id>/admin-transition/',
        AdminContractTransitionView.as_view(), name='contract-admin-transition',
    ),
    path(
        'me/reservations/<uuid:reservation_id>/contracts/',
        MyContractListView.as_view(), name='my-contracts',
    ),
    path('me/contracts/<uuid:contract_id>/sign/', MyContractSignView.as_view(), name='my-contract-sign'),
    # Ticket B-050 — appels de fonds.
    path(
        'reservations/<uuid:reservation_id>/payment-calls/admin/',
        TeamPaymentCallView.as_view(), name='payment-call-team',
    ),
    path(
        'me/reservations/<uuid:reservation_id>/payment-calls/',
        MyPaymentCallListView.as_view(), name='my-payment-calls',
    ),
    # Ticket B-051 — encaissements simulés.
    path('finance/reservations/<uuid:reservation_id>/', FinanceFileView.as_view(), name='finance-file'),
    path(
        'finance/reservations/<uuid:reservation_id>/receipts/',
        ReceiptCreateView.as_view(), name='finance-receipt-create',
    ),
    path(
        'finance/receipts/<uuid:receipt_id>/allocations/',
        AllocationCreateView.as_view(), name='finance-allocation-create',
    ),
    path(
        'finance/receipts/<uuid:receipt_id>/reconcile/',
        ReceiptReconcileView.as_view(), name='finance-receipt-reconcile',
    ),
    # Ticket B-052 — décaissements simulés.
    path('finance/accounts/', ProgramAccountListView.as_view(), name='finance-account-list'),
    path('finance/programs/<uuid:program_id>/account/', ProgramAccountView.as_view(), name='finance-program-account'),
    path('finance/disbursements/', DisbursementCreateView.as_view(), name='finance-disbursement-create'),
    path(
        'finance/disbursements/<uuid:disbursement_id>/eligibility/',
        DisbursementEligibilityView.as_view(), name='finance-disbursement-eligibility',
    ),
    path(
        'finance/disbursements/<uuid:disbursement_id>/execute/',
        DisbursementExecuteView.as_view(), name='finance-disbursement-execute',
    ),
    path(
        'finance/disbursements/<uuid:disbursement_id>/cancel/',
        DisbursementCancelView.as_view(), name='finance-disbursement-cancel',
    ),
    path(
        'finance/disbursements/<uuid:disbursement_id>/reconcile/',
        DisbursementReconcileView.as_view(), name='finance-disbursement-reconcile',
    ),
    path('build/disbursements/', BeneficiaryDisbursementListView.as_view(), name='beneficiary-disbursement-list'),
    path(
        'build/disbursements/<uuid:disbursement_id>/confirm/',
        BeneficiaryDisbursementConfirmView.as_view(), name='beneficiary-disbursement-confirm',
    ),
]
