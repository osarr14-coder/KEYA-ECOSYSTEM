from django.core import signing
from django.http import FileResponse, Http404
from django.urls import reverse
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.viewsets import OrganizationScopedMixin
from apps.messaging.mixins import MessageThreadMixin

from . import access, services
from .models import Document, Evidence, WorkDeclaration
from .permissions import IsConstructeur
from .serializers import (
    DocumentSerializer,
    DocumentUploadSerializer,
    EvidenceSerializer,
    WorkDeclarationSerializer,
)


class DocumentViewSet(
    MessageThreadMixin,
    OrganizationScopedMixin,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Pas d'update/destroy exposés pour le MVP — un Document est un objet
    de GED versionné, pas un simple champ éditable (ticket 004 ne demande
    pas de CRUD complet, contrairement au ticket 002 pour Program/Asset/Lot).
    """

    queryset = Document.objects.all()
    parser_classes = [MultiPartParser]

    def get_serializer_class(self):
        if self.action == 'create':
            return DocumentUploadSerializer
        return DocumentSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = serializer.save()
        return Response(DocumentSerializer(document).data, status=201)

    def get_message_subject(self):
        """Ticket 011 — `get_object()` seul (organisation active) ne
        suffit PAS pour un `Document` : un document `confidentiel` doit
        rester exclu de tout membre qui n'en est ni le propriétaire ni
        `admin_keyimmo`, exactement la même règle déjà appliquée par
        `signed_url` (ticket 004) — réutilisée ici telle quelle, jamais
        redéfinie. Volontairement une surcharge de CETTE seule méthode
        (pas de `get_object()`) : `RetrieveModelMixin`/`signed_url` gardent
        leur comportement du ticket 004 inchangé, hors scope de ce ticket.
        """
        document = self.get_object()
        if not access.user_can_access_document(self.request.user, document, self.request.organization):
            raise PermissionDenied('Ce document confidentiel ne vous est pas accessible.')
        return document

    @action(detail=True, methods=['get'])
    def signed_url(self, request, pk=None):
        """Seul moyen d'obtenir un lien de téléchargement — jamais
        `file.url` directement (voir apps/evidence/access.py). `get_object()`
        applique déjà le filtre par organisation active du ViewSet ;
        `user_can_access_document` applique en plus la règle spécifique à
        `sensitivity_level` (un document confidentiel n'est pas accessible à
        n'importe quel membre de l'organisation, voir access.py).
        """
        document = self.get_object()
        if not access.user_can_access_document(request.user, document, request.organization):
            raise PermissionDenied('Ce document confidentiel ne vous est pas accessible.')
        token = access.generate_download_token(document.id)
        return Response({
            'url': reverse('document-download', args=[token]),
            'expires_in': access.DOWNLOAD_TOKEN_MAX_AGE_SECONDS,
        })


class DocumentDownloadView(APIView):
    """Seule route qui sert réellement le contenu d'un `Document`. Deux
    vérifications indépendantes, jamais une seule (ticket 004, critère
    d'acceptation) :
    - le token doit être valide et non expiré (prouve qu'il a été émis par
      `DocumentViewSet.signed_url`) ;
    - le demandeur doit être authentifié ET membre de l'organisation du
      document *au moment du téléchargement* — pas seulement au moment où
      le lien a été émis (l'appartenance a pu changer entre-temps).
    404 (jamais 403) dans tous les cas d'échec, pour ne pas laisser deviner
    l'existence d'un document via le code de statut.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, token):
        try:
            document_id = access.verify_download_token(token)
        except signing.BadSignature:
            raise Http404

        document = Document.objects.filter(id=document_id).first()
        organization = getattr(request, 'organization', None)
        if document is None or organization is None or document.organization_id != organization.id:
            raise Http404
        if not access.user_can_access_document(request.user, document, organization):
            raise Http404

        return FileResponse(document.file.open('rb'), as_attachment=True, filename=document.file.name)


class WorkDeclarationViewSet(
    OrganizationScopedMixin,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = WorkDeclaration.objects.all()
    serializer_class = WorkDeclarationSerializer

    def get_permissions(self):
        permission_instances = [permissions.IsAuthenticated()]
        if self.action == 'create':
            permission_instances.append(IsConstructeur())
        return permission_instances

    def perform_create(self, serializer):
        organization = self.request.organization
        if organization is None:
            raise PermissionDenied('Aucune organisation active pour cette requête.')
        serializer.instance = services.create_work_declaration(
            organization=organization,
            milestone=serializer.validated_data['milestone'],
            declared_by=self.request.user,
            note=serializer.validated_data.get('note', ''),
        )


class EvidenceViewSet(
    OrganizationScopedMixin,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Evidence.objects.all()
    serializer_class = EvidenceSerializer

    def perform_create(self, serializer):
        organization = self.request.organization
        if organization is None:
            raise PermissionDenied('Aucune organisation active pour cette requête.')
        serializer.instance = services.create_evidence(
            organization=organization,
            work_declaration=serializer.validated_data['work_declaration'],
            documents=serializer.validated_data['documents'],
            added_by=self.request.user,
        )
