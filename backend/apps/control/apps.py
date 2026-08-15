from django.apps import AppConfig


class ControlConfig(AppConfig):
    """Aucun modèle propre à cette app (sauf `Inspection.client_correlation_id`,
    qui vit dans `apps.inspections` — le champ appartient au domaine
    propriétaire, pas à sa voie d'écriture). Couche d'API dédiée à la
    synchronisation réseau de la PWA CONTROL (`/apps/control-pwa`, ticket
    010) : reçoit ce qu'un inspecteur a saisi hors ligne et le fait
    transiter par les fonctions déjà validées d'`apps.inspections` et
    `apps.evidence`, avec la détection de conflit ajoutée à
    `apps.inspections.services.create_inspection` (passe 2). Label explicite
    pour éviter toute ambiguïté avec le mot générique « control » (ex :
    contrôle de version, contrôle d'accès), même schéma que `apps.build`
    (`build_control_tower`) et `apps.home` (`client_home`).
    """

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.control'
    label = 'control_sync'
