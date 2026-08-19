from django.urls import path

from .views import (
    AdminLotSearchView,
    AdminOrganizationSearchView,
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
    # Ticket B-028 — ces deux routes n'ont pas de segment `<uuid:...>`
    # avant leur nom final, contrairement à `procurement-admin-devis-list`
    # ci-dessus (`.../lots/<uuid:lot_id>/devis/`) : `.../lots/` et
    # `.../organizations/` sont des motifs DISTINCTS pour le résolveur
    # Django, aucune collision possible.
    path('procurement/admin/lots/', AdminLotSearchView.as_view(), name='procurement-admin-lot-search'),
    path(
        'procurement/admin/organizations/',
        AdminOrganizationSearchView.as_view(), name='procurement-admin-organization-search',
    ),
]
