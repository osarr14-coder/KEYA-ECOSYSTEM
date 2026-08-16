from django.urls import path

from .views import DeactivateUserView, UserDetailView, UserSearchView

urlpatterns = [
    path('backoffice/users/', UserSearchView.as_view(), name='backoffice-user-search'),
    path('backoffice/users/<uuid:user_id>/', UserDetailView.as_view(), name='backoffice-user-detail'),
    path(
        'backoffice/users/<uuid:user_id>/deactivate/',
        DeactivateUserView.as_view(), name='backoffice-user-deactivate',
    ),
]
