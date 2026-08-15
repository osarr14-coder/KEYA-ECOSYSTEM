from django.db.models import Case, F, IntegerField, Value, When
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.generics import ListAPIView
from rest_framework.response import Response

from apps.core.viewsets import OrganizationScopedMixin

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
        queryset = Task.objects.filter(assignee=self.request.user)

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
