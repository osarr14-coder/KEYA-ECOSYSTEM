from django.urls import path

from .views import (
    AdminReservationCancelView,
    AdminReservationListView,
    CatalogLotListView,
    MyReservationCancelView,
    MyReservationListView,
    ReservationCreateView,
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
]
