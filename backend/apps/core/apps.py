from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.core'
    label = 'ecosystem_core'

    def ready(self):
        # Lot 5 (PO-2026-09-29-02) : aucune écriture sur une instance archivée.
        from apps.core import archive

        archive.connect()
