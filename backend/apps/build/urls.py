from django.urls import path

from .views import AllLotsView, ExceptionsView

urlpatterns = [
    path('build/exceptions/', ExceptionsView.as_view(), name='build-exceptions'),
    path('build/lots/', AllLotsView.as_view(), name='build-lots'),
]
