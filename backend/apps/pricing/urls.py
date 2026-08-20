from django.urls import path

from .views import (
    ControlOfficeRateCreateView,
    ControlOfficeRateCurrentView,
    ControlOfficeRateHistoryView,
    LegalPaymentTierTemplateActivateView,
    LegalPaymentTierTemplateActiveView,
    LegalPaymentTierTemplateCreateView,
    LegalPaymentTierTemplateHistoryView,
    PricingConfigCreateView,
    PricingConfigCurrentView,
    PricingConfigHistoryView,
)

urlpatterns = [
    path('pricing/configs/', PricingConfigCreateView.as_view(), name='pricing-config-create'),
    path('pricing/configs/current/', PricingConfigCurrentView.as_view(), name='pricing-config-current'),
    path('pricing/configs/history/', PricingConfigHistoryView.as_view(), name='pricing-config-history'),
    path(
        'pricing/legal-payment-tier-templates/',
        LegalPaymentTierTemplateCreateView.as_view(), name='legal-payment-tier-template-create',
    ),
    path(
        'pricing/legal-payment-tier-templates/<uuid:template_id>/activate/',
        LegalPaymentTierTemplateActivateView.as_view(), name='legal-payment-tier-template-activate',
    ),
    path(
        'pricing/legal-payment-tier-templates/active/',
        LegalPaymentTierTemplateActiveView.as_view(), name='legal-payment-tier-template-active',
    ),
    path(
        'pricing/legal-payment-tier-templates/history/',
        LegalPaymentTierTemplateHistoryView.as_view(), name='legal-payment-tier-template-history',
    ),
    path(
        'pricing/control-office-rates/',
        ControlOfficeRateCreateView.as_view(), name='control-office-rate-create',
    ),
    path(
        'pricing/control-office-rates/current/',
        ControlOfficeRateCurrentView.as_view(), name='control-office-rate-current',
    ),
    path(
        'pricing/control-office-rates/history/',
        ControlOfficeRateHistoryView.as_view(), name='control-office-rate-history',
    ),
]
