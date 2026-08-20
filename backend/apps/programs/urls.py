from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AssetViewSet,
    LotViewSet,
    ProgramCostCreateView,
    ProgramCostCurrentView,
    ProgramCostHistoryView,
    ProgramCostRepartitionView,
    ProgramViewSet,
)

router = DefaultRouter()
router.register('programs', ProgramViewSet, basename='program')
router.register('assets', AssetViewSet, basename='asset')
router.register('lots', LotViewSet, basename='lot')

# Ticket B-033 — `APIView` explicites ajoutées à côté du router
# (`admin_keyimmo`, garde transverse pas scopée à l'organisation active,
# ne s'exprime pas naturellement dans `OrganizationScopedMixin`), pas des
# actions de ViewSet.
urlpatterns = router.urls + [
    path(
        'programs/<uuid:program_id>/costs/',
        ProgramCostCreateView.as_view(), name='program-cost-create',
    ),
    path(
        'programs/<uuid:program_id>/costs/current/',
        ProgramCostCurrentView.as_view(), name='program-cost-current',
    ),
    path(
        'programs/<uuid:program_id>/costs/history/',
        ProgramCostHistoryView.as_view(), name='program-cost-history',
    ),
    path(
        'programs/<uuid:program_id>/costs/repartition/',
        ProgramCostRepartitionView.as_view(), name='program-cost-repartition',
    ),
]
