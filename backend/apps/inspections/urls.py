from rest_framework.routers import DefaultRouter

from .views import InspectionViewSet, ReserveCorrectionViewSet, ReserveViewSet

router = DefaultRouter()
router.register('inspections', InspectionViewSet, basename='inspection')
router.register('reserves', ReserveViewSet, basename='reserve')
router.register('reserve-corrections', ReserveCorrectionViewSet, basename='reservecorrection')

urlpatterns = router.urls
