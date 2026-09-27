from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AdminTaskCompleteView,
    AdminTaskInboxView,
    InspectorTaskCompleteView,
    InspectorTaskInboxView,
    MyInboxCompleteView,
    MyInboxView,
    MyTasksView,
    TaskViewSet,
)

router = DefaultRouter()
router.register('tasks', TaskViewSet, basename='task')

# Ticket B-044/B-045 — listées AVANT `router.urls` : `tasks/admin-inbox/`
# correspond au motif de la route détail par défaut du routeur
# (`tasks/<pk>/`, pk='admin-inbox') — même piège de collision déjà
# rencontré et corrigé au ticket B-042 (`programs/requests/`).
urlpatterns = [
    path('me/tasks/', MyTasksView.as_view(), name='my-tasks'),
    # Ticket B-056 — boîte transverse de l'utilisateur courant.
    path('me/tasks/inbox/', MyInboxView.as_view(), name='my-task-inbox'),
    path('me/tasks/<uuid:task_id>/inbox-complete/', MyInboxCompleteView.as_view(), name='my-task-inbox-complete'),
    path('tasks/admin-inbox/', AdminTaskInboxView.as_view(), name='task-admin-inbox'),
    path('tasks/<uuid:task_id>/admin-complete/', AdminTaskCompleteView.as_view(), name='task-admin-complete'),
    path('tasks/inspector-inbox/', InspectorTaskInboxView.as_view(), name='task-inspector-inbox'),
    path(
        'tasks/<uuid:task_id>/inspector-complete/',
        InspectorTaskCompleteView.as_view(), name='task-inspector-complete',
    ),
] + router.urls
