from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.evidence.serializers import EvidenceSerializer
from apps.inspections import services as inspections_services
from apps.inspections.permissions import IsInspecteur
from apps.inspections.serializers import InspectionSerializer

from . import services
from .serializers import SyncDocumentSerializer, SyncEvidenceSerializer, SyncInspectionSerializer


class SyncDocumentView(APIView):
    """`POST /api/control/sync/documents/` — un item de la file média
    (ticket 010, passe 2). Compression déjà faite côté client (voir
    CLAUDE.md) : ce endpoint ne fait que recevoir le blob déjà réduit,
    exactement comme `DocumentViewSet.create` (ticket 004) dont il réutilise
    `apps.evidence.services.create_document` — seule différence : bascule
    explicite de contexte RLS puisque l'inspecteur n'est jamais membre de
    l'organisation cible (voir apps/control/services.py).
    """

    permission_classes = [permissions.IsAuthenticated, IsInspecteur]
    parser_classes = [MultiPartParser]

    def post(self, request):
        serializer = SyncDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            document = services.sync_document(
                inspector=request.user,
                inspector_organization=request.organization,
                target_organization_id=data['organization'],
                uploaded_file=data['file'],
                category=data['category'],
                source=data['source'],
                captured_at=data.get('captured_at'),
                correlation_id=data['correlation_id'],
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'messages', [str(exc)]))

        return Response({'id': str(document.id)}, status=201)


class SyncEvidenceView(APIView):
    """`POST /api/control/sync/evidence/` — regroupe les documents déjà
    synchronisés (via `SyncDocumentView`) en une `Evidence` rattachée au
    `WorkDeclaration` inspecté. Indépendant de `SyncInspectionView` : une
    Evidence peut être synchronisée avant, après, ou même sans qu'aucune
    Inspection n'ait encore été synchronisée pour ce brouillon (voir
    CLAUDE.md, section CONTROL PWA, addendum passe 2).
    """

    permission_classes = [permissions.IsAuthenticated, IsInspecteur]

    def post(self, request):
        serializer = SyncEvidenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            evidence = services.sync_evidence(
                inspector=request.user,
                inspector_organization=request.organization,
                target_organization_id=data['organization'],
                work_declaration_id=data['work_declaration'],
                document_ids=[str(document_id) for document_id in data['documents']],
                correlation_id=data['correlation_id'],
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'messages', [str(exc)]))

        return Response(EvidenceSerializer(evidence).data, status=201)


class SyncInspectionView(APIView):
    """`POST /api/control/sync/inspection/` — la file de synchronisation des
    données (ticket 010, passe 2) : checklist/commentaire/décision saisis
    hors ligne, envoyés dès le retour du réseau. Statut de réponse :
    - 201 : appliqué, `Inspection` créée (corps : `InspectionSerializer`) ;
    - 409 : conflit détecté — RIEN n'a été créé, le client doit repasser cet
      item en statut `conflict` et ne JAMAIS réessayer automatiquement tant
      qu'un inspecteur (ou rôle habilité) n'a pas tranché explicitement
      (critère d'acceptation le plus important de cette passe, voir ticket).
    """

    permission_classes = [permissions.IsAuthenticated, IsInspecteur]

    def post(self, request):
        serializer = SyncInspectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        known_latest_event_id = data.get('known_latest_event_id')

        try:
            outcome = services.sync_inspection(
                inspector=request.user,
                inspector_organization=request.organization,
                target_organization_id=data['organization'],
                work_declaration_id=data['work_declaration'],
                outcome=data['outcome'],
                note=data.get('note', ''),
                correlation_id=data['correlation_id'],
                known_latest_event_id=str(known_latest_event_id) if known_latest_event_id else None,
                reserve_id=data.get('reserve'),
            )
        except inspections_services.IndependenceRuleViolation as exc:
            raise PermissionDenied(str(exc))
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'messages', [str(exc)]))

        if outcome.status == 'conflict':
            current_event = outcome.current_event
            return Response({
                'status': 'conflict',
                'current_event': {
                    'id': str(current_event.id) if current_event else None,
                    'level': current_event.level if current_event else None,
                    'source': current_event.source if current_event else None,
                    'created_at': current_event.created_at if current_event else None,
                } if current_event else None,
            }, status=409)

        return Response(
            {'status': 'applied', 'inspection': InspectionSerializer(outcome.inspection).data},
            status=201,
        )
