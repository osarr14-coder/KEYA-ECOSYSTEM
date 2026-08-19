from django.urls import path

from .views import (
    DevisAdminListView,
    DevisAjustementView,
    DevisCreateView,
    DevisLockView,
    MyCandidaturesDetailView,
    MyCandidaturesListView,
)

urlpatterns = [
    path('procurement/devis/', DevisCreateView.as_view(), name='procurement-devis-create'),
    path('procurement/devis/<uuid:devis_id>/lock/', DevisLockView.as_view(), name='procurement-devis-lock'),
    path(
        'procurement/admin/lots/<uuid:lot_id>/devis/',
        DevisAdminListView.as_view(), name='procurement-admin-devis-list',
    ),
    path('procurement/my-candidatures/', MyCandidaturesListView.as_view(), name='procurement-my-candidatures'),
    path(
        'procurement/my-candidatures/<uuid:devis_id>/',
        MyCandidaturesDetailView.as_view(), name='procurement-my-candidature-detail',
    ),
    path(
        'procurement/devis/<uuid:devis_id>/ajustements/',
        DevisAjustementView.as_view(), name='procurement-devis-ajustement',
    ),
]
