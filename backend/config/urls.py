from django.contrib import admin
from django.urls import include, path

from apps.accounts.views import MeView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('apps.accounts.urls')),
    path('api/me/', MeView.as_view(), name='me'),
    path('api/', include('apps.programs.urls')),
    path('api/', include('apps.evidence.urls')),
    path('api/', include('apps.inspections.urls')),
    path('api/', include('apps.tasks.urls')),
    path('api/', include('apps.home.urls')),
    path('api/', include('apps.build.urls')),
    path('api/', include('apps.control.urls')),
    path('api/', include('apps.backoffice.urls')),
    path('api/', include('apps.procurement.urls')),
    path('api/', include('apps.pricing.urls')),
]
