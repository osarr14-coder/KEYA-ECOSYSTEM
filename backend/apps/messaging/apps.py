from django.apps import AppConfig


class MessagingConfig(AppConfig):
    """Ticket 011 — `Message` rattaché à un objet métier existant (Lot,
    Reserve, Document), jamais une messagerie libre sans contexte (voir
    `services.py::ALLOWED_SUBJECT_MODELS`). Aucun endpoint propre à cette
    app : les routes vivent en `@action` sur les ViewSets EXISTANTS de
    chaque type de sujet (`LotViewSet`, `ReserveViewSet`, `DocumentViewSet`)
    — c'est ce qui permet d'hériter de leurs permissions déjà en place
    (`get_object()`) sans écrire de nouvelle logique de permission, comme
    demandé explicitement par le ticket.
    """

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.messaging'
    label = 'messaging'
