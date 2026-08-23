from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AssetViewSet,
    LotViewSet,
    MyProgramRequestsView,
    ProgramCostCreateView,
    ProgramCostCurrentView,
    ProgramCostHistoryView,
    ProgramCostRepartitionView,
    ProgramRequestDecisionView,
    ProgramRequestListCreateView,
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
#
# Ticket B-042 — les 3 routes `programs/requests/...` DOIVENT être listées
# AVANT `router.urls` : `programs/requests/` a EXACTEMENT la même forme que
# la route détail du router (`programs/<pk>/`, regex par défaut
# `[^/.]+`) — Django essaie les urlpatterns dans l'ordre, le premier
# pattern qui matche gagne. Listées après `router.urls` (comme les routes
# `.../costs/...` ci-dessous, qui ne collisionnent PAS : un segment
# supplémentaire après le `pk` ne matche jamais la route détail), la route
# détail du router aurait intercepté `programs/requests/` en traitant
# `"requests"` comme un `pk` — bug réel rencontré en écrivant ce ticket
# (404/405 selon la méthode, jamais la vue attendue).
urlpatterns = [
    path(
        'programs/requests/',
        ProgramRequestListCreateView.as_view(), name='program-request-list-create',
    ),
    path(
        'programs/requests/mine/',
        MyProgramRequestsView.as_view(), name='program-request-mine',
    ),
    path(
        'programs/requests/<uuid:request_id>/decide/',
        ProgramRequestDecisionView.as_view(), name='program-request-decide',
    ),
] + router.urls + [
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
