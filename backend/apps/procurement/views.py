from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import permissions
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmo
from apps.evidence.permissions import IsConstructeur

from . import services
from .models import Devis
from .serializers import DevisAdminSerializer, DevisCandidateSerializer, DevisCreateSerializer


class DevisCreateView(APIView):
    """`POST /api/procurement/devis/` — ticket 022, réservé à
    `admin_keyimmo` (décision de conception 1 : aucun endpoint d'écriture
    pour le rôle constructeur candidat). La validation métier (lot dans
    l'organisation cible, verrouillage déjà posé) vit dans
    `apps.procurement.services.create_devis` — cette vue ne fait que
    vérifier le rôle admin et déléguer, même schéma que
    `apps.backoffice.views.CreateMissionView` (ticket 012).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request):
        serializer = DevisCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            devis = services.create_devis(
                logged_by=request.user,
                logged_by_organization_id=request.organization.id if request.organization else None,
                target_organization_id=data['organization'],
                lot_id=data['lot'],
                candidate_organization_id=data['candidate_organization'],
                amount=data['amount'],
            )
        except services.LotAlreadyLockedError as exc:
            # 409, pas 400 : le corps de la requête était valide, c'est
            # l'ÉTAT du lot (déjà verrouillé) qui rend l'opération
            # impossible — même sémantique que `SyncInspectionView` (ticket
            # 010, `apps/control/views.py`), qui renvoie aussi un 409
            # construit explicitement plutôt qu'une DRF `ValidationError`
            # (400 par défaut).
            return Response({'detail': str(exc)}, status=409)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))

        return Response(DevisAdminSerializer(devis, context={'request': request}).data, status=201)


class DevisLockView(APIView):
    """`POST /api/procurement/devis/{devis_id}/lock/` — ticket 022, réservé
    à `admin_keyimmo`. Verrouille LE devis retenu pour son lot (un seul par
    lot, voir `apps.procurement.services.lock_devis`). `organization`
    (l'organisation du lot) est fourni dans le corps — même conséquence
    assumée que `DevisCreateView`/`create_inspection` (ticket 005) :
    nécessaire pour la bascule RLS, ne peut pas être dérivé après coup.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request, devis_id):
        target_organization_id = request.data.get('organization')
        if not target_organization_id:
            raise ValidationError({'organization': 'Ce champ est requis.'})

        try:
            devis = services.lock_devis(
                admin=request.user,
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=target_organization_id,
                devis_id=devis_id,
            )
        except services.LotAlreadyLockedError as exc:
            return Response({'detail': str(exc)}, status=409)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))

        return Response(DevisAdminSerializer(devis, context={'request': request}).data, status=200)


class DevisAdminListView(APIView):
    """`GET /api/procurement/admin/lots/{lot_id}/devis/` — ticket 022,
    réservé à `admin_keyimmo`. **Seul endpoint de ce module qui expose des
    montants** (`DevisAdminSerializer`) — voir le test de garde,
    `apps/procurement/tests.py::TestDevisAmountNeverLeaksToConstructeurRole`.
    `organization_id` (l'organisation du lot) est un paramètre de requête,
    même conséquence assumée que `DevisCreateView`.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request, lot_id):
        target_organization_id = request.query_params.get('organization_id')
        if not target_organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})

        devis_list = services.list_devis_for_lot_as_admin(
            admin=request.user,
            admin_organization_id=request.organization.id if request.organization else None,
            target_organization_id=target_organization_id,
            lot_id=lot_id,
        )
        return Response(DevisAdminSerializer(devis_list, many=True, context={'request': request}).data)


class MyCandidaturesListView(APIView):
    """`GET /api/procurement/my-candidatures/` — ticket 022, réservé au
    rôle `constructeur` de l'organisation active. Ses propres candidatures
    UNIQUEMENT (`candidate_organization = request.organization`) —
    `DevisCandidateSerializer`, **jamais de champ `amount`** (décision de
    conception 2). RLS reste le filet de sécurité en plus, jamais le seul
    filtre (même discipline que le reste du projet, ex. `MyTasksView`,
    ticket 006).
    """

    permission_classes = [permissions.IsAuthenticated, IsConstructeur]

    def get(self, request):
        devis_list = Devis.objects.filter(
            candidate_organization=request.organization,
        ).order_by('-created_at')
        return Response(DevisCandidateSerializer(devis_list, many=True, context={'request': request}).data)


class MyCandidaturesDetailView(APIView):
    """`GET /api/procurement/my-candidatures/{devis_id}/` — même scope que
    `MyCandidaturesListView`. Une candidature d'un AUTRE candidat renvoie
    404, jamais 403 (même discipline que
    `apps.home.views._ClientLotScopedView.get_lot_or_404`, ticket 008) —
    on ne confirme jamais l'existence d'une candidature concurrente à qui
    que ce soit.
    """

    permission_classes = [permissions.IsAuthenticated, IsConstructeur]

    def get(self, request, devis_id):
        devis = Devis.objects.filter(
            id=devis_id, candidate_organization=request.organization,
        ).first()
        if devis is None:
            raise NotFound()
        return Response(DevisCandidateSerializer(devis, context={'request': request}).data)
