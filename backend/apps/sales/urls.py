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
    PublicOfferView,
    PublicWorksitesView,
    DisbursementCancelView,
    DisbursementCreateView,
    DisbursementEligibilityView,
    DisbursementExecuteView,
    DisbursementReconcileView,
    FinanceFileView,
    MyContractListView,
    MyContractSignView,
    MyPaymentCallListView,
    MyWorksiteView,
    MyPaymentNoticeCreateView,
    MyReservationCancelView,
    MyReservationListView,
    FinanceReceiptListView,
    PaymentNoticeAttachView,
    PaymentNoticeConfirmView,
    PaymentNoticeListView,
    PaymentNoticeRejectView,
    ProgramAccountListView,
    ProgramAccountView,
    ReceiptCreateView,
    ReceiptReconcileView,
    ReservationCreateView,
    ReservationValidateView,
    TeamPaymentCallView,
)

urlpatterns = [
    path('catalog/lots/', CatalogLotListView.as_view(), name='catalog-lot-list'),
    # Ticket B-057 — vitrine publique anonyme (page d'accueil, F-079).
    path('public/offer/', PublicOfferView.as_view(), name='public-offer'),
    path('public/worksites/', PublicWorksitesView.as_view(), name='public-worksites'),
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
    # PO-2026-09-28-04 — suivi du chantier du bien du client.
    path('me/reservations/<uuid:reservation_id>/worksite/', MyWorksiteView.as_view(), name='my-worksite'),
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
    # Ticket B-056 — validation ADV, avis de paiement du client.
    path(
        'reservations/<uuid:reservation_id>/validate/',
        ReservationValidateView.as_view(), name='reservation-validate',
    ),
    path(
        'me/payment-calls/<uuid:payment_call_id>/notices/',
        MyPaymentNoticeCreateView.as_view(), name='my-payment-notice-create',
    ),
    path('finance/payment-notices/', PaymentNoticeListView.as_view(), name='finance-payment-notice-list'),
    path(
        'finance/payment-notices/<uuid:notice_id>/confirm/',
        PaymentNoticeConfirmView.as_view(), name='finance-payment-notice-confirm',
    ),
    path(
        'finance/payment-notices/<uuid:notice_id>/reject/',
        PaymentNoticeRejectView.as_view(), name='finance-payment-notice-reject',
    ),
    # PO-2026-09-28-01, PO-2026-09-28-02.
    path(
        'finance/payment-notices/<uuid:notice_id>/attach/',
        PaymentNoticeAttachView.as_view(), name='finance-payment-notice-attach',
    ),
    path('finance/receipts/', FinanceReceiptListView.as_view(), name='finance-receipt-list'),
]
