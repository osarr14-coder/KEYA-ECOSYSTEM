from django.urls import path

from .views import DossierChronologyView, IndicatorSourcesView, IndicatorsView

urlpatterns = [
    path('pilotage/indicateurs/', IndicatorsView.as_view(), name='pilotage-indicators'),
    path('pilotage/indicateurs/<str:key>/sources/', IndicatorSourcesView.as_view(), name='pilotage-indicator-sources'),
    path('dossiers/<uuid:reservation_id>/chronologie/', DossierChronologyView.as_view(), name='dossier-chronology'),
]
