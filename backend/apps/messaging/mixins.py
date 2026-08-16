from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from . import services
from .serializers import MessageCreateSerializer, MessageSerializer


class MessageThreadMixin:
    """Ajoute `GET/POST /<ressource>/{id}/messages/` à un ViewSet dont
    `get_object()` (ou `get_message_subject()`, voir ci-dessous) incarne
    déjà le filtre de permission complet du type de sujet concerné — ticket
    011, critère d'acceptation : « hérite des permissions existantes, sans
    nouvelle logique de permission à inventer ». Centralise UNE SEULE fois
    la plomberie (sérialisation, traduction `ValidationError`) commune aux
    trois ViewSets porteurs (`LotViewSet`/`ReserveViewSet`/`DocumentViewSet`)
    plutôt que de la tripler à l'identique.
    """

    def get_message_subject(self):
        """Point d'extension : par défaut, le `get_object()` standard du
        ViewSet (organisation active, via `OrganizationScopedMixin`).
        `DocumentViewSet` le surcharge pour ajouter la nuance
        `sensitivity_level` (`apps.evidence.access.user_can_access_document`)
        — sans modifier `get_object()` lui-même, qui resterait alors
        utilisé aussi par `RetrieveModelMixin`/`signed_url` : hors scope de
        ce ticket, ces deux routes gardent leur comportement du ticket 004
        inchangé.
        """
        return self.get_object()

    # `parser_classes` explicite ici : `DocumentViewSet` (ticket 004) fixe
    # `parser_classes = [MultiPartParser]` au niveau CLASSE (nécessaire pour
    # `create`, qui reçoit un fichier) — sans cette précision, cette action
    # en hériterait et rejetterait un corps JSON `{"body": "..."}` en 415.
    # `MessageCreateSerializer` n'a jamais besoin de multipart lui-même,
    # mais l'accepter aussi ne coûte rien et couvre un futur client qui
    # choisirait ce format.
    @action(detail=True, methods=['get', 'post'], parser_classes=[JSONParser, FormParser, MultiPartParser])
    def messages(self, request, pk=None):
        subject = self.get_message_subject()

        if request.method == 'POST':
            serializer = MessageCreateSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            try:
                message = services.create_message(
                    subject=subject, author=request.user, body=serializer.validated_data['body'],
                )
            except DjangoValidationError as exc:
                raise ValidationError(getattr(exc, 'messages', [str(exc)]))
            return Response(MessageSerializer(message).data, status=201)

        thread = services.list_messages_for_subject(subject)
        return Response(MessageSerializer(thread, many=True).data)
