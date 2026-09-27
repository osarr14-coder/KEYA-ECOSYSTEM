from django.urls import path

from .views import (
    AdminContractListCreateView,
    AdminContractTransitionView,
    AdminContractUpdateView,
    AdminReservationCancelView,
    AdminReservationListView,
    CatalogLotListView,
    MyContractListView,
    MyContractSignView,
    MyPaymentCallListView,
    MyReservationCancelView,
    MyReservationListView,
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
]
