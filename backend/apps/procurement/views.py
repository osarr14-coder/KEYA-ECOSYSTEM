from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import permissions
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmo
from apps.evidence.permissions import IsConstructeur
from apps.programs import services as programs_services

from . import services
from .models import Devis
from .serializers import (
    DevisAdminSerializer,
    DevisAjustementAdminSerializer,
    DevisAjustementCreateSerializer,
    DevisCandidateSerializer,
    DevisCreateSerializer,
    LotLedgerCreateSerializer,
    LotLedgerSerializer,
    LotSearchResultSerializer,
    OrganizationSearchResultSerializer,
)


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
        except (services.LotAlreadyLockedError, services.NoPricingConfigError) as exc:
            # 409, pas 400 : le corps de la requête était valide, c'est
            # l'ÉTAT du système (lot déjà verrouillé, OU aucun taux
            # PricingConfig actif — ticket 026) qui rend l'opération
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


class DevisAjustementView(APIView):
    """`POST/GET /api/procurement/devis/{devis_id}/ajustements/` — ticket
    023, réservé à `admin_keyimmo`. Une seule vue pour les deux méthodes
    (convention REST standard sur une même URL de collection), plutôt que
    deux classes sur des chemins distincts.

    **POST** : enregistre un ajustement de coût sur le devis VERROUILLÉ
    d'un lot — voir `apps.procurement.services.create_ajustement` pour la
    validation métier complète (devis verrouillé, marge disponible
    courante, signe de l'écart). `organization` (l'organisation du lot)
    fourni dans le corps — même conséquence assumée que `DevisCreateView`.

    **GET** : historique complet des ajustements de ce devis, montants
    inclus — `organization_id` en paramètre de requête, même conséquence
    assumée. Aucune lecture candidate de ce modèle dans ce ticket (décision
    de conception, point C).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request, devis_id):
        serializer = DevisAjustementCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            ajustement, marge_resultante = services.create_ajustement(
                admin=request.user,
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=data['organization'],
                devis_id=devis_id,
                ecart=data['ecart'],
            )
        except (services.DevisNotLockedError, services.MarginExceededError) as exc:
            # 409 dans les deux cas : le corps de la requête est valide,
            # c'est l'ÉTAT du devis (pas verrouillé, ou marge insuffisante)
            # qui rend l'opération impossible — même sémantique que
            # DevisCreateView/DevisLockView (ticket 022).
            return Response({'detail': str(exc)}, status=409)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))

        response_data = DevisAjustementAdminSerializer(ajustement).data
        response_data['marge_resultante'] = marge_resultante
        return Response(response_data, status=201)

    def get(self, request, devis_id):
        target_organization_id = request.query_params.get('organization_id')
        if not target_organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})

        ajustements = services.list_ajustements_for_devis_as_admin(
            admin=request.user,
            admin_organization_id=request.organization.id if request.organization else None,
            target_organization_id=target_organization_id,
            devis_id=devis_id,
        )
        return Response(DevisAjustementAdminSerializer(ajustements, many=True).data)


class AdminLotSearchView(APIView):
    """`GET /api/procurement/admin/lots/?q=<recherche>` — ticket B-028,
    réservé à `admin_keyimmo`. Recherche de lot par nom, TOUTES
    organisations confondues (y compris celles dont `admin_keyimmo` n'est
    membre d'AUCUNE), en préparation de `POST /api/procurement/devis/` —
    voir `apps.procurement.services.search_lots_as_admin` pour le
    mécanisme complet (boucle de bascule RLS par organisation) et son
    coût assumé au pire cas.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        lots = services.search_lots_as_admin(
            admin=request.user,
            admin_organization_id=request.organization.id if request.organization else None,
            query=query,
        )
        return Response(LotSearchResultSerializer(lots, many=True).data)


class LotLedgerCreateView(APIView):
    """`POST /api/procurement/lot-ledgers/` — ticket B-035, réservé à
    `admin_keyimmo`. Crée le grand-livre d'un lot (`prix_client`, snapshot
    foncier/BE) — voir `apps.procurement.services.create_lot_ledger` pour
    la validation métier complète (devis verrouillé, un seul grand-livre
    par lot). Aucun endpoint `PUT`/`PATCH`/`DELETE` n'existe nulle part
    pour cette ressource (immuable, voir la migration RLS dédiée).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request):
        serializer = LotLedgerCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            ledger = services.create_lot_ledger(
                admin=request.user,
                admin_organization_id=request.organization.id if request.organization else None,
                target_organization_id=data['organization'],
                lot_id=data['lot'],
                prix_client=data['prix_client'],
            )
        except (
            services.LotDevisNotLockedError,
            services.LotLedgerAlreadyExistsError,
            programs_services.NoProgramCostError,
            programs_services.LotMissingSurfaceError,
        ) as exc:
            # 409, pas 400 : le corps de la requête est valide, c'est
            # l'ÉTAT du lot/programme (devis pas encore verrouillé, grand-
            # livre déjà existant, aucun ProgramCost enregistré, ou un lot
            # sans surface pour prorata_surface) qui rend l'opération
            # impossible — même sémantique que DevisCreateView/
            # ProgramCostRepartitionView.
            return Response({'detail': str(exc)}, status=409)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))

        return Response(LotLedgerSerializer(ledger).data, status=201)


class LotLedgerDetailView(APIView):
    """`GET /api/procurement/lot-ledgers/{lot_id}/?organization_id=<id>` —
    ticket B-035, réservé à `admin_keyimmo`. Retourne `null` si aucun
    grand-livre n'existe encore pour ce lot (même convention que
    `ProgramCostCurrentView`, jamais une 404 pour une absence légitime).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request, lot_id):
        target_organization_id = request.query_params.get('organization_id')
        if not target_organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})

        ledger = services.get_lot_ledger(
            admin_organization_id=request.organization.id if request.organization else None,
            target_organization_id=target_organization_id,
            lot_id=lot_id,
        )
        if ledger is None:
            return Response(None)
        return Response(LotLedgerSerializer(ledger).data)


class LotLedgerMarginView(APIView):
    """`GET /api/procurement/lot-ledgers/{lot_id}/margin/?organization_id=<id>`
    — ticket B-035, réservé à `admin_keyimmo`. Marge disponible COURANTE
    du grand-livre de ce lot — voir `apps.procurement.services.
    get_lot_ledger_margin` pour la formule (VOLONTAIREMENT incomplète dans
    ce ticket, TODO B-036). 404 si aucun grand-livre n'existe encore pour
    ce lot — contrairement à `LotLedgerDetailView`, une marge n'a aucun
    sens tant que le grand-livre lui-même n'existe pas.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request, lot_id):
        target_organization_id = request.query_params.get('organization_id')
        if not target_organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})

        ledger, margin = services.get_lot_ledger_margin_for_lot(
            admin_organization_id=request.organization.id if request.organization else None,
            target_organization_id=target_organization_id,
            lot_id=lot_id,
        )
        if ledger is None:
            raise NotFound("Aucun grand-livre n'existe pour ce lot.")
        return Response({'margin': margin})


class AdminOrganizationSearchView(APIView):
    """`GET /api/procurement/admin/organizations/?q=<recherche>` — ticket
    B-028, réservé à `admin_keyimmo`. Recherche d'organisation par nom,
    pour résoudre `candidate_organization` avant
    `POST /api/procurement/devis/` — voir
    `apps.procurement.services.search_organizations_as_admin`.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        organizations = services.search_organizations_as_admin(query)
        return Response(OrganizationSearchResultSerializer(organizations, many=True).data)
