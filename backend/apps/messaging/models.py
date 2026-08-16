import uuid

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from apps.organizations.models import Organization


class Message(models.Model):
    """Toujours rattaché à un objet métier existant — jamais une messagerie
    libre sans contexte (critère d'acceptation du ticket 011). Référence
    polymorphe exactement comme `TrustEvent` (ticket 003) et `Task` (ticket
    006) : `subject_type`/`subject_id` via `django.contrib.contenttypes`,
    restreinte en pratique aux trois types autorisés par le ticket (Lot,
    Reserve, Document) — la vérification a lieu dans
    `services.py::create_message` (`ALLOWED_SUBJECT_MODELS`), pas ici
    (un `ContentType` générique ne peut pas être contraint par un simple
    `CheckConstraint` SQL portable).

    `organization` est dénormalisé depuis le sujet référencé (même pattern
    que `Asset.organization` depuis `Asset.program`, ticket 002) — c'est ce
    qui permet à `Message` de porter la policy RLS standard par colonne
    (voir migration 0002), sans jointure : la visibilité d'un message
    découle entièrement de celle de son sujet, jamais d'une logique de
    permission propre à la messagerie (critère d'acceptation : « hérite des
    permissions existantes »).

    Pas d'`update`/`delete` exposés (voir `apps/messaging/services.py` et
    l'absence de toute action en ce sens sur les ViewSets porteurs) — même
    choix que `Document` (ticket 004) : un message n'est pas un champ
    éditable au MVP. Contrairement à `TrustEvent`, ceci n'est PAS une
    garantie append-only au niveau DB (pas la doctrine Visible Trust,
    juste un contenu utilisateur) — seulement une action non exposée par
    l'API pour l'instant.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='messages',
    )

    subject_type = models.ForeignKey(ContentType, on_delete=models.PROTECT)
    subject_id = models.UUIDField()
    subject = GenericForeignKey('subject_type', 'subject_id')

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='messages',
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'messaging_message'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['subject_type', 'subject_id']),
        ]

    def __str__(self):
        return f'Message de {self.author.email} — {self.subject_type} {self.subject_id}'
