from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AdminTaskCompleteView, AdminTaskInboxView, MyTasksView, TaskViewSet

router = DefaultRouter()
router.register('tasks', TaskViewSet, basename='task')

# Ticket B-044 — listées AVANT `router.urls` : `tasks/admin-inbox/`
# correspond au motif de la route détail par défaut du routeur
# (`tasks/<pk>/`, pk='admin-inbox') — même piège de collision déjà
# rencontré et corrigé au ticket B-042 (`programs/requests/`).
urlpatterns = [
    path('me/tasks/', MyTasksView.as_view(), name='my-tasks'),
    path('tasks/admin-inbox/', AdminTaskInboxView.as_view(), name='task-admin-inbox'),
    path('tasks/<uuid:task_id>/admin-complete/', AdminTaskCompleteView.as_view(), name='task-admin-complete'),
] + router.urls
