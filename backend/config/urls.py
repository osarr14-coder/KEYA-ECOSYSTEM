from django.conf import settings
from django.contrib import admin
from django.http import HttpResponseRedirect, JsonResponse
from django.urls import include, path

from apps.accounts.views import MeView
from apps.core.views import DemoInstanceView


def backend_root(request):
    """Ticket B-055 — `/` du backend : redirection vers l'application web
    (`WEB_APP_URL`) plutôt que le 404 brut de Django ; sans configuration,
    une réponse JSON explicite. Aucune donnée exposée."""
    if settings.WEB_APP_URL:
        return HttpResponseRedirect(settings.WEB_APP_URL)
    return JsonResponse({
        'service': 'API KEYIMMO AFRIC (démonstration)',
        'detail': "Ceci est l'API. Ouvrez l'application web pour vous connecter.",
    })


urlpatterns = [
    path('', backend_root, name='backend-root'),
    path('admin/', admin.site.urls),
    path('api/auth/', include('apps.accounts.urls')),
    path('api/me/', MeView.as_view(), name='me'),
    path('api/public/demo-instance/', DemoInstanceView.as_view(), name='public-demo-instance'),
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
    path('api/', include('apps.organizations.urls')),
    path('api/', include('apps.sales.urls')),
    path('api/', include('apps.audit.urls')),
]
