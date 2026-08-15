from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import MyTasksView, TaskViewSet

router = DefaultRouter()
router.register('tasks', TaskViewSet, basename='task')

urlpatterns = [
    path('me/tasks/', MyTasksView.as_view(), name='my-tasks'),
] + router.urls
