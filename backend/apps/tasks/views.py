from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.generics import ListAPIView
from rest_framework.response import Response

from apps.core.viewsets import OrganizationScopedMixin

from . import services
from .models import Task
from .serializers import TaskSerializer


class MyTasksView(ListAPIView):
    """`GET /api/me/tasks/` — ticket 006 : chaque utilisateur voit, en un
    seul endroit, toutes les actions qui lui incombent. Scopé sur
    `assignee=request.user`, pas sur l'organisation active comme le reste
    du projet : un utilisateur voit SES tâches, pas toutes celles de son
    organisation. RLS reste un filet de sécurité en plus (l'organisation
    active doit de toute façon correspondre), jamais à la place de ce
    filtre applicatif.
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
