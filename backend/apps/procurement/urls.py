from django.urls import path

from .views import (
    AdminLotSearchView,
    AdminOrganizationSearchView,
    DevisAdminListView,
    DevisAjustementView,
    DevisCreateView,
    DevisLockView,
    LotBcChargeListView,
    LotLedgerCreateView,
    LotLedgerDetailView,
    LotLedgerMarginView,
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
    # Ticket B-035 — grand-livre de coûts par lot (canal 1), première
    # partie (le grand-livre seul, sans les charges bureau de contrôle).
    path('procurement/lot-ledgers/', LotLedgerCreateView.as_view(), name='lot-ledger-create'),
    path(
        'procurement/lot-ledgers/<uuid:lot_id>/',
        LotLedgerDetailView.as_view(), name='lot-ledger-detail',
    ),
    path(
        'procurement/lot-ledgers/<uuid:lot_id>/margin/',
        LotLedgerMarginView.as_view(), name='lot-ledger-margin',
    ),
    # Ticket B-036 — charges bureau de contrôle (canal 1), second
    # sous-ticket : historique des charges d'un lot.
    path(
        'procurement/lot-ledgers/<uuid:lot_id>/bc-charges/',
        LotBcChargeListView.as_view(), name='lot-bc-charge-list',
    ),
]
