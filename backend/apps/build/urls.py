from django.urls import path

from .views import AllLotsView, ExceptionsView, LotMilestonesView

urlpatterns = [
    path('build/exceptions/', ExceptionsView.as_view(), name='build-exceptions'),
    path('build/lots/', AllLotsView.as_view(), name='build-lots'),
    # Ticket B-054 — jalons d'un lot et leur état de contrôle.
    path('build/lots/<uuid:lot_id>/milestones/', LotMilestonesView.as_view(), name='build-lot-milestones'),
]
