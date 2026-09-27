from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.demo import active_demo_instance, demo_instance_payload


class DemoInstanceView(APIView):
    """`GET /api/public/demo-instance/` — audit UI R1 (M01, D01). Identifiant
    de l'instance de démonstration active, affiché par le bandeau de TOUS
    les écrans (y compris connexion et page publique) : aucune
    authentification, lecture seule, débit limité. `{"instance": null}` hors
    démonstration."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'public'
    throttle_classes = [ScopedRateThrottle]

    def get(self, request):
        return Response({'instance': demo_instance_payload(active_demo_instance())})
