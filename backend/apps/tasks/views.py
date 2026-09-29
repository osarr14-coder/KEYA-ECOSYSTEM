from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Case, F, IntegerField, Value, When
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backoffice.permissions import IsAdminKeyimmo
from apps.core.viewsets import OrganizationScopedMixin
from apps.inspections.permissions import IsInspecteur

from . import services
from .models import Task, TaskPriority
from .serializers import TaskSerializer

# Rang numérique explicite — l'ordre alphabétique de TaskPriority.choices
# ('high' < 'low' < 'normal') ne correspond PAS à l'ordre de priorité réel,
# donc un simple `order_by('priority')` serait faux. Utilisé uniquement par
# `?ordering=priority` (ticket 008, résumé de la tâche prioritaire en Vue
# d'ensemble) — jamais recalculé côté frontend, voir apps/home.
_PRIORITY_RANK = Case(
    When(priority=TaskPriority.HIGH, then=Value(0)),
    When(priority=TaskPriority.NORMAL, then=Value(1)),
    When(priority=TaskPriority.LOW, then=Value(2)),
    default=Value(3),
    output_field=IntegerField(),
)


class MyTasksView(ListAPIView):
    """`GET /api/me/tasks/` — ticket 006 : chaque utilisateur voit, en un
    seul endroit, toutes les actions qui lui incombent. Scopé sur
    `assignee=request.user`, pas sur l'organisation active comme le reste
    du projet : un utilisateur voit SES tâches, pas toutes celles de son
    organisation. RLS reste un filet de sécurité en plus (l'organisation
    active doit de toute façon correspondre), jamais à la place de ce
    filtre applicatif.

    `?ordering=priority` (ticket 008) : tri par priorité (haute d'abord),
    puis échéance la plus proche, puis le plus récent — ajouté pour que le
    résumé « prochaine action » de HOME (`apps/home`) consomme CE MÊME
    endpoint plutôt qu'une logique de sélection dupliquée côté frontend.
    Sans ce paramètre, le comportement historique (le plus récent d'abord)
    est inchangé — aucune régression pour les appelants existants.
    """

    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Lot 5 (PO-2026-09-29-01, -03) : les tâches d'une instance archivée
        # sortent de la boîte (et de la cloche) de chacun.
        from apps.core.models import DemoInstance, DemoInstanceStatus

        archived_programs = [
            program_id
            for ids in DemoInstance.objects.filter(status=DemoInstanceStatus.ARCHIVED).values_list('program_ids', flat=True)
            for program_id in ids or []
        ]
        queryset = Task.objects.filter(assignee=self.request.user).exclude(program_id__in=archived_programs)

        task_type = self.request.query_params.get('type')
        if task_type:
            queryset = queryset.filter(type=task_type)

        status_param = self.request.query_params.get('status')
        if status_param:
            queryset = queryset.filter(status=status_param)

        program_id = self.request.query_params.get('program')
        if program_id:
            queryset = queryset.filter(program_id=program_id)

        if self.request.query_params.get('ordering') == 'priority':
            return queryset.annotate(_priority_rank=_PRIORITY_RANK).order_by(
                '_priority_rank', F('due_date').asc(nulls_last=True), '-created_at',
            )

        return queryset.order_by('-created_at')


class TaskViewSet(
    OrganizationScopedMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Lecture + action `complete`, scopées par organisation active comme
    tout le reste du projet — `MyTasksView` ci-dessus reste le point
    d'entrée principal du ticket (« GET /me/tasks »), mais marquer une
    tâche traitée a besoin d'une route par id.
    """

    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        task = self.get_object()
        services.complete_task(task)
        return Response(TaskSerializer(task).data)


class AdminTaskInboxView(APIView):
    """`GET /api/tasks/admin-inbox/?status=` — ticket B-044 : les tâches
    assignées à `admin_keyimmo` pour une organisation TIERCE
    (`devis_ajustement_refuse`/`lot_ledger_margin_negative`, tickets
    023/B-036) ne remontent jamais via `MyTasksView` (RLS `tasks_task`
    mono-organisation). Voir `services.list_my_tasks_across_
    organizations` (généralisée au ticket B-045, voir `InspectorTaskInboxView`
    ci-dessous — même mécanisme, rôle différent).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def get(self, request):
        status_filter = request.query_params.get('status')
        tasks = services.list_my_tasks_across_organizations(
            user=request.user,
            caller_organization_id=request.organization.id if request.organization else None,
            status=status_filter,
        )
        return Response(TaskSerializer(tasks, many=True).data)


class AdminTaskCompleteView(APIView):
    """`POST /api/tasks/{id}/admin-complete/?organization_id=<id>` —
    ticket B-044 : complète une tâche dont l'organisation est CELLE
    FOURNIE (pas l'organisation active de l'appelant) — voir
    `services.complete_task_across_organizations`. URL distincte de
    `tasks/{pk}/complete/` (`TaskViewSet.complete` ci-dessus, inchangé).
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminKeyimmo]

    def post(self, request, task_id):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
        try:
            task = services.complete_task_across_organizations(
                caller_organization_id=request.organization.id if request.organization else None,
                target_organization_id=organization_id,
                task_id=task_id,
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(TaskSerializer(task).data)


class InspectorTaskInboxView(APIView):
    """`GET /api/tasks/inspector-inbox/?status=` — ticket B-045 : les
    tâches `mission_assigned` (ticket 012) assignées à un inspecteur
    pour la mission d'un client TIERS (organisation dont il n'est jamais
    membre, règle d'indépendance ticket 005) ne remontent jamais via
    `MyTasksView`. Même mécanisme EXACT que `AdminTaskInboxView`
    ci-dessus — `IsInspecteur` vérifie déjà « inspecteur dans
    l'organisation active », suffisant ici : la boucle interne
    (`list_my_tasks_across_organizations`) fait le reste, aucune
    dépendance à ce que l'organisation active corresponde à la mission —
    même réutilisation cross-org déjà faite par
    `apps.control.views.MissionListView`.
    """

    permission_classes = [permissions.IsAuthenticated, IsInspecteur]

    def get(self, request):
        status_filter = request.query_params.get('status')
        tasks = services.list_my_tasks_across_organizations(
            user=request.user,
            caller_organization_id=request.organization.id if request.organization else None,
            status=status_filter,
        )
        return Response(TaskSerializer(tasks, many=True).data)


class InspectorTaskCompleteView(APIView):
    """`POST /api/tasks/{id}/inspector-complete/?organization_id=<id>` —
    ticket B-045. Même mécanisme EXACT que `AdminTaskCompleteView`
    ci-dessus.
    """

    permission_classes = [permissions.IsAuthenticated, IsInspecteur]

    def post(self, request, task_id):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
        try:
            task = services.complete_task_across_organizations(
                caller_organization_id=request.organization.id if request.organization else None,
                target_organization_id=organization_id,
                task_id=task_id,
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, 'message_dict', getattr(exc, 'messages', [str(exc)])))
        return Response(TaskSerializer(task).data)


class MyInboxView(APIView):
    """`GET /api/me/tasks/inbox/?status=` — ticket B-056 : toutes MES tâches,
    toutes organisations (celles du circuit de vente vivent dans
    l'organisation du lot, jamais dans celle du client ni de l'équipe
    KEYIMMO). Même boucle que les boîtes admin/inspecteur ;
    `assignee = request.user` seulement."""

    permission_classes = [permissions.IsAuthenticated]

    # Mêmes filtres que `MyTasksView` (HOME les utilise déjà) : `type`,
    # `status`, `program`, `ordering=priority` — appliqués en mémoire après
    # la boucle transverse (volume d'une boîte personnelle).
    _PRIORITY_ORDER = {TaskPriority.HIGH: 0, TaskPriority.NORMAL: 1, TaskPriority.LOW: 2}

    def get(self, request):
        params = request.query_params
        tasks = services.list_my_tasks_across_organizations(
            user=request.user,
            caller_organization_id=request.organization.id if request.organization else None,
            status=params.get('status'),
        )
        if params.get('type'):
            tasks = [task for task in tasks if task.type == params['type']]
        if params.get('program'):
            tasks = [task for task in tasks if str(task.program_id) == params['program']]
        tasks.sort(key=lambda task: task.created_at, reverse=True)
        if params.get('ordering') == 'priority':
            tasks.sort(key=lambda task: (
                self._PRIORITY_ORDER.get(task.priority, 1),
                task.due_date is None,
                task.due_date or task.created_at,
            ))
        return Response(TaskSerializer(tasks, many=True).data)


class MyInboxCompleteView(APIView):
    """`POST /api/me/tasks/{id}/inbox-complete/?organization_id=` — ticket
    B-056 : marque traitée UNE DE MES tâches (404 pour celle d'un autre)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, task_id):
        organization_id = request.query_params.get('organization_id')
        if not organization_id:
            raise ValidationError({'organization_id': 'Ce paramètre de requête est requis.'})
        try:
            task = services.complete_my_task_across_organizations(
                user=request.user,
                caller_organization_id=request.organization.id if request.organization else None,
                target_organization_id=organization_id,
                task_id=task_id,
            )
        except DjangoValidationError:
            raise NotFound('Tâche introuvable.')
        return Response(TaskSerializer(task).data)
