from rest_framework import permissions, status
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


class AdminInstancesView(APIView):
    """`GET /api/admin/instances/` — lot 5 (PO-2026-09-29-01) : instances de
    démonstration (code, version du jeu, dates, origine, conservation), pour
    l'administrateur et le gestionnaire, qui peuvent consulter une archive."""

    def get_permissions(self):
        from apps.backoffice.permissions import IsAdminKeyimmoOrGestionnaireADV

        return [permissions.IsAuthenticated(), IsAdminKeyimmoOrGestionnaireADV()]

    def get(self, request):
        from apps.core.instances import campaign_end, instance_rows

        end = campaign_end()
        return Response({
            'campaign_end': end.isoformat() if end else None,
            'retention_days': 90,
            'instances': instance_rows(),
        })


class AdminArchiveInstanceView(APIView):
    """`POST /api/admin/instances/archive/` — lot 5 (étape 11,
    PO-2026-09-29-03) : archive l'instance active et en crée une nouvelle
    depuis le jeu versionné. Administrateur seul ; confirmation par saisie
    du code de l'instance (`confirm_code`)."""

    def get_permissions(self):
        from apps.backoffice.permissions import IsAdminKeyimmo

        return [permissions.IsAuthenticated(), IsAdminKeyimmo()]

    def post(self, request):
        from apps.core.instances import archive_active_instance

        archived, created = archive_active_instance(
            actor=request.user,
            caller_organization_id=request.organization.id if request.organization else None,
            confirm_code=str(request.data.get('confirm_code') or ''),
        )
        return Response({
            'archived': demo_instance_payload(archived),
            'created': demo_instance_payload(created),
        }, status=status.HTTP_201_CREATED)
