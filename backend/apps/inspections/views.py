from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import mixins, permissions, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.core.viewsets import OrganizationScopedMixin
from apps.evidence.permissions import IsConstructeur
from apps.messaging.mixins import MessageThreadMixin

from . import services
from .models import Inspection, Reserve, ReserveCorrection
from .permissions import IsInspecteur
from .serializers import (
    InspectionCreateSerializer,
    InspectionSerializer,
    ReserveCorrectionCreateSerializer,
    ReserveCorrectionSerializer,
    ReserveSerializer,
)


class InspectionViewSet(
    OrganizationScopedMixin,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Seule route qui fait progresser le cycle de vie d'une `Reserve` — un
    constructeur bloqué ici (`IsInspecteur`) ne peut, par construction,
    changer le statut d'aucune réserve : il n'existe aucune autre porte
    d'entrée (voir `ReserveViewSet`, en lecture seule).
    """

    queryset = Inspection.objects.all()

    def get_serializer_class(self):
        if self.action == 'create':
            return InspectionCreateSerializer
        return InspectionSerializer

    def get_permissions(self):
        permission_instances = [permissions.IsAuthenticated()]
        if self.action == 'create':
            permission_instances.append(IsInspecteur())
        return permission_instances

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            inspection = services.create_inspection(
                inspector=request.user,
                inspector_organization=request.organization,
                target_organization_id=data['organization'],
                work_declaration_id=data.get('work_declaration'),
                evidence_id=data.get('evidence'),
                outcome=data['outcome'],
                note=data.get('note', ''),
                reserve_id=data.get('reserve'),
            )
        except services.IndependenceRuleViolation as exc:
            raise PermissionDenied(str(exc))
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'messages', [str(exc)]))

        return Response(InspectionSerializer(inspection).data, status=201)


class ReserveViewSet(
    MessageThreadMixin,
    OrganizationScopedMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Volontairement en lecture seule — aucun `create`/`update`/`destroy`.
    Une `Reserve` n'a pas de champ statut à modifier : son état se dérive
    du dernier `TrustEvent` (voir `ReserveSerializer.get_status`), produit
    uniquement par `InspectionViewSet.create` ou
    `ReserveCorrectionViewSet.create`. Une tentative de `PATCH`/`PUT`/
    `DELETE` ici renvoie 405 (méthode non autorisée) — il n'existe
    littéralement aucun code qui pourrait l'honorer.

    L'action `messages` (GET/POST, ticket 011, voir `MessageThreadMixin`)
    hérite du même filtre par organisation que `list`/`retrieve` ci-dessus
    — un inspecteur n'étant jamais membre de l'organisation cible (règle
    d'indépendance, ticket 005), il ne peut, comme pour la relecture de ses
    propres inspections, ni lire ni écrire de message sur une réserve
    cross-organisation via cette route (limite déjà documentée par
    `apps.inspections.services.create_inspection`, pas quelque chose que ce
    ticket doit résoudre).
    """

    queryset = Reserve.objects.all()
    serializer_class = ReserveSerializer


class ReserveCorrectionViewSet(
    OrganizationScopedMixin,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = ReserveCorrection.objects.all()

    def get_serializer_class(self):
        if self.action == 'create':
            return ReserveCorrectionCreateSerializer
        return ReserveCorrectionSerializer

    def get_permissions(self):
        permission_instances = [permissions.IsAuthenticated()]
        if self.action == 'create':
            permission_instances.append(IsConstructeur())
        return permission_instances

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        correction = serializer.save()
        return Response(ReserveCorrectionSerializer(correction).data, status=201)
