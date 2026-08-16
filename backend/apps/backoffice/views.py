from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import permissions
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.inspections import services as inspections_services

from . import services
from .permissions import IsAdminKeyimmo
from .serializers import (
    MissionAdminSerializer,
    MissionCreateSerializer,
    UserDetailSerializer,
    UserSummarySerializer,
)


class UserSearchView(APIView):
    """`GET /api/backoffice/users/?q=<recherche>` — recherche d'un
    utilisateur par email (ticket 011). Réservé à `admin_keyimmo` (voir
    `IsAdminKeyimmo`). `q` absent ou vide : liste vide, jamais un dump
    complet de la table des utilisateurs.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        users = services.search_users(query)
        return Response(UserSummarySerializer(users, many=True).data)


class UserDetailView(APIView):
    """`GET /api/backoffice/users/{id}/` — organisation(s)/rôle(s) de
    l'utilisateur (ticket 011, « consultation de son organisation/rôle »).
    Lecture seule : aucun champ de ce endpoint ni de son serializer ne
    permet de modifier quoi que ce soit — seule `DeactivateUserView`
    ci-dessous écrit, et seulement `User.is_active`.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request, user_id):
        target_user = User.objects.filter(id=user_id).first()
        if target_user is None:
            raise NotFound('Utilisateur introuvable.')
        memberships = services.get_user_memberships(admin_user=request.user, target_user=target_user)
        return Response(UserDetailSerializer({'user': target_user, 'memberships': memberships}).data)


class DeactivateUserView(APIView):
    """`POST /api/backoffice/users/{id}/deactivate/` — bloque l'accès de ce
    compte immédiatement, sans supprimer aucune donnée historique (voir
    `services.deactivate_user`, critère d'acceptation du ticket 011).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request, user_id):
        target_user = User.objects.filter(id=user_id).first()
        if target_user is None:
            raise NotFound('Utilisateur introuvable.')
        services.deactivate_user(target_user)
        return Response(UserSummarySerializer(target_user).data)


class CreateMissionView(APIView):
    """`POST /api/backoffice/missions/` — ticket 012 : affecte un
    inspecteur à un `WorkDeclaration` à contrôler. Réservé à
    `admin_keyimmo` (voir `IsAdminKeyimmo`) — décision de conception
    validée : laisser le constructeur choisir (même indirectement) son
    propre inspecteur affaiblirait la règle d'indépendance dès
    l'affectation. La validation métier elle-même (règle d'indépendance,
    rôle inspecteur) vit dans `apps.inspections.services.create_mission` —
    cette vue ne fait que vérifier le rôle admin et déléguer.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request):
        serializer = MissionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        assigned_inspector = User.objects.filter(id=data['assigned_inspector']).first()
        if assigned_inspector is None:
            raise ValidationError({'assigned_inspector': 'Utilisateur introuvable.'})

        try:
            mission = inspections_services.create_mission(
                assigned_by=request.user,
                assigned_by_organization_id=request.organization.id if request.organization else None,
                target_organization_id=data['organization'],
                work_declaration_id=data['work_declaration'],
                assigned_inspector=assigned_inspector,
            )
        except inspections_services.IndependenceRuleViolation as exc:
            raise PermissionDenied(str(exc))
        except inspections_services.NotAnInspectorError as exc:
            raise ValidationError({'assigned_inspector': str(exc)})
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'messages', [str(exc)]))

        return Response(MissionAdminSerializer(mission).data, status=201)
