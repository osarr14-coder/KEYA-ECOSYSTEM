from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .pagination import LotPagination


class ExceptionsView(APIView):
    """`GET /api/build/exceptions/` — vue Exceptions (ticket 009), vue PAR
    DÉFAUT de BUILD, critère d'acceptation central : les exceptions
    apparaissent au-dessus de tout KPI, jamais l'inverse — ce endpoint
    n'expose d'ailleurs AUCUN indicateur agrégé, seulement les 5 catégories
    d'exceptions. Le frontend affiche un état vide explicite par catégorie
    vide, jamais un retour vers un tableau de bord KPI par défaut (aucun
    KPI n'existe même à retourner ici).
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        organization = request.organization
        if organization is None:
            return Response({
                'lots_en_retard': [], 'controles_a_planifier': [], 'capacites_manquantes': [],
                'reserves_ouvertes': [], 'documents_manquants': [],
            })
        return Response(services.get_exceptions(organization))


class AllLotsView(APIView):
    """`GET /api/build/lots/` — vue « Tous les lots » (ticket 009) : tri,
    filtres, pagination, tous calculés/appliqués côté backend. Les lignes
    sont matérialisées en un nombre borné de requêtes SQL par
    `services.build_lot_rows` (voir ce module) — le tri/filtre/pagination
    ci-dessous n'opèrent qu'en mémoire Python sur cette liste déjà chargée,
    aucune requête supplémentaire par ligne.
    """

    permission_classes = [permissions.IsAuthenticated]
    pagination_class = LotPagination

    ALLOWED_ORDERING_FIELDS = {
        'name', 'created_at', 'progress_percentage', 'milestone_count', 'open_reserve_count',
    }
    DEFAULT_ORDERING_FIELD = 'name'

    def get(self, request):
        organization = request.organization
        if organization is None:
            rows = []
        else:
            rows = services.build_lot_rows(organization)
            rows = self._filter(rows, request)
            rows = self._sort(rows, request)

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(rows, request, view=self)
        return paginator.get_paginated_response(page)

    @staticmethod
    def _filter(rows, request):
        program_id = request.query_params.get('program')
        if program_id:
            rows = [row for row in rows if row['program_id'] == program_id]

        assigned = request.query_params.get('assigned')
        if assigned == 'true':
            rows = [row for row in rows if row['assigned_organization_id'] is not None]
        elif assigned == 'false':
            rows = [row for row in rows if row['assigned_organization_id'] is None]

        search = request.query_params.get('q')
        if search:
            needle = search.lower()
            rows = [row for row in rows if needle in row['name'].lower()]

        return rows

    def _sort(self, rows, request):
        ordering = request.query_params.get('ordering', self.DEFAULT_ORDERING_FIELD)
        descending = ordering.startswith('-')
        field = ordering[1:] if descending else ordering
        if field not in self.ALLOWED_ORDERING_FIELDS:
            field = self.DEFAULT_ORDERING_FIELD
            descending = False
        return sorted(rows, key=lambda row: row[field], reverse=descending)
