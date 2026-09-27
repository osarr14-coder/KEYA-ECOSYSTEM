from django.urls import path

from .views import AdminJournalView

urlpatterns = [
    path('admin/journal/', AdminJournalView.as_view(), name='admin-journal'),
]
