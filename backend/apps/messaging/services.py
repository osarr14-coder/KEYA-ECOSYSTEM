from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError

from apps.evidence.models import Document
from apps.inspections.models import Reserve
from apps.programs.models import Lot

from .models import Message

# Les seuls objets métier auxquels un message peut être rattaché — critère
# d'acceptation du ticket 011 : « un message est toujours rattaché à un
# objet métier existant, jamais une messagerie libre sans contexte ».
# Vérifié ici explicitement plutôt que de faire confiance à l'appelant :
# les vues qui créent des messages (`LotViewSet.messages`,
# `ReserveViewSet.messages`, `DocumentViewSet.messages`) ne peuvent
# structurellement passer qu'un objet de l'un de ces trois types, mais
# cette liste reste la définition explicite, testable indépendamment de
# ces vues (voir apps/messaging/tests.py).
ALLOWED_SUBJECT_MODELS = (Lot, Reserve, Document)


def create_message(*, subject, author, body):
    """`subject` est déjà résolu par l'appelant via le `get_object()` du
    ViewSet du type concerné — c'est CETTE résolution qui applique le
    filtre de permission existant (organisation active, et pour un
    `Document`, `apps.evidence.access.user_can_access_document`). Cette
    fonction ne fait donc AUCUNE vérification de permission propre : la
    permission a déjà été tranchée avant d'arriver ici, exactement comme
    demandé par le ticket (« sans nouvelle logique de permission à
    inventer »).
    """
    if not isinstance(subject, ALLOWED_SUBJECT_MODELS):
        raise ValidationError(
            "Un message doit être rattaché à un lot, une réserve ou un document existant.",
        )
    body = body.strip()
    if not body:
        raise ValidationError("Le message ne peut pas être vide.")

    return Message.objects.create(
        organization=subject.organization, subject=subject, author=author, body=body,
    )


def list_messages_for_subject(subject):
    content_type = ContentType.objects.get_for_model(subject)
    return (
        Message.objects.filter(subject_type=content_type, subject_id=subject.pk)
        .select_related('author')
        .order_by('created_at')
    )
