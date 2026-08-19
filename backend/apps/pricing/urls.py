from django.urls import path

from .views import PricingConfigCreateView, PricingConfigCurrentView, PricingConfigHistoryView

urlpatterns = [
    path('pricing/configs/', PricingConfigCreateView.as_view(), name='pricing-config-create'),
    path('pricing/configs/current/', PricingConfigCurrentView.as_view(), name='pricing-config-current'),
    path('pricing/configs/history/', PricingConfigHistoryView.as_view(), name='pricing-config-history'),
]
