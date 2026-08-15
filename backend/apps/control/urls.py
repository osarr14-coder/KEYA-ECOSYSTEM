from django.urls import path

from .views import SyncDocumentView, SyncEvidenceView, SyncInspectionView

urlpatterns = [
    path('control/sync/documents/', SyncDocumentView.as_view(), name='control-sync-document'),
    path('control/sync/evidence/', SyncEvidenceView.as_view(), name='control-sync-evidence'),
    path('control/sync/inspection/', SyncInspectionView.as_view(), name='control-sync-inspection'),
]
