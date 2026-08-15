from rest_framework.routers import DefaultRouter

from .views import AssetViewSet, LotViewSet, ProgramViewSet

router = DefaultRouter()
router.register('programs', ProgramViewSet, basename='program')
router.register('assets', AssetViewSet, basename='asset')
router.register('lots', LotViewSet, basename='lot')

urlpatterns = router.urls
