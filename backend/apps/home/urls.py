from django.urls import path

from .views import LotEvidenceFeedView, LotLitigesView, LotOverviewView, MyLotsView

urlpatterns = [
    path('me/lots/', MyLotsView.as_view(), name='my-lots'),
    path('me/lots/<uuid:lot_id>/overview/', LotOverviewView.as_view(), name='my-lot-overview'),
    path('me/lots/<uuid:lot_id>/evidence/', LotEvidenceFeedView.as_view(), name='my-lot-evidence'),
    path('me/lots/<uuid:lot_id>/litiges/', LotLitigesView.as_view(), name='my-lot-litiges'),
]
