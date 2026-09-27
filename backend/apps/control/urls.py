from django.urls import path

from .views import (
    MissionDetailView, MissionDocumentView, MissionListView, MissionOpinionView, SyncDocumentView,
    SyncEvidenceView, SyncInspectionView,
)

urlpatterns = [
    path('control/sync/documents/', SyncDocumentView.as_view(), name='control-sync-document'),
    path('control/sync/evidence/', SyncEvidenceView.as_view(), name='control-sync-evidence'),
    path('control/sync/inspection/', SyncInspectionView.as_view(), name='control-sync-inspection'),
    path('control/missions/', MissionListView.as_view(), name='control-mission-list'),
    # Audit UI R1 (K01–K04) : avis en ligne.
    path('control/missions/<uuid:mission_id>/', MissionDetailView.as_view(), name='control-mission-detail'),
    path('control/missions/<uuid:mission_id>/avis/', MissionOpinionView.as_view(), name='control-mission-opinion'),
    path(
        'control/missions/<uuid:mission_id>/documents/<uuid:document_id>/',
        MissionDocumentView.as_view(), name='control-mission-document',
    ),
]
