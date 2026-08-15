from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DocumentDownloadView, DocumentViewSet, EvidenceViewSet, WorkDeclarationViewSet

router = DefaultRouter()
router.register('documents', DocumentViewSet, basename='document')
router.register('work-declarations', WorkDeclarationViewSet, basename='workdeclaration')
router.register('evidences', EvidenceViewSet, basename='evidence')

urlpatterns = [
    # Doit précéder router.urls : sinon `documents/<pk>/` (motif générique du
    # router) intercepterait `documents/download/<token>/` avant cette route.
    path('documents/download/<str:token>/', DocumentDownloadView.as_view(), name='document-download'),
] + router.urls
