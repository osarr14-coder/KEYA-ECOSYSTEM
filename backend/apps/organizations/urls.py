from django.urls import path

from .views import CountryPackListView

urlpatterns = [
    path('organizations/country-packs/', CountryPackListView.as_view(), name='country-pack-list'),
]
