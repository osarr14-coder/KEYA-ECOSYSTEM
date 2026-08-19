from django.apps import AppConfig


class PricingAppConfig(AppConfig):
    """Nommée `PricingAppConfig`, pas `PricingConfig` comme le suggérerait la
    convention `<Nom>Config` suivie ailleurs (`ProcurementConfig`,
    `InspectionsConfig`...) — évite une collision de nom avec le modèle
    métier `PricingConfig` (`models.py`), qui porte délibérément ce nom
    (celui du ticket 025) plutôt que le renommer pour cette raison
    accessoire.
    """

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.pricing'
    label = 'pricing'
