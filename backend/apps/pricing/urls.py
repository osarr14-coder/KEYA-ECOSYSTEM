from django.urls import path

from .views import (
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
]
