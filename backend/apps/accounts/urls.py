from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import RegisterView, ThrottledLoginView

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('login/', ThrottledLoginView.as_view(), name='login'),
    path('login/refresh/', TokenRefreshView.as_view(), name='login-refresh'),
]
