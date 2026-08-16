from django.urls import path

from .views import CreateMissionView, DeactivateUserView, UserDetailView, UserSearchView

urlpatterns = [
    path('backoffice/users/', UserSearchView.as_view(), name='backoffice-user-search'),
    path('backoffice/users/<uuid:user_id>/', UserDetailView.as_view(), name='backoffice-user-detail'),
    path(
        'backoffice/users/<uuid:user_id>/deactivate/',
        DeactivateUserView.as_view(), name='backoffice-user-deactivate',
    ),
    # Ticket 012 — quatrième route ajoutée consciemment : voir
    # apps/backoffice/tests.py::TestBackofficeNeverExposesATrustEventShortcut
    # ::test_backoffice_urls_expose_exactly_the_three_documented_actions
    # (ticket 011), mis à jour en conséquence pour lister EXACTEMENT les 4
    # routes désormais réelles — le test de garde a fait exactement son
    # travail : forcer une décision consciente plutôt qu'un ajout silencieux.
    path('backoffice/missions/', CreateMissionView.as_view(), name='backoffice-mission-create'),
]
