from rest_framework import serializers

from .models import Message


class MessageSerializer(serializers.ModelSerializer):
    author = serializers.EmailField(source='author.email', read_only=True)
    # Label humain ('lot'/'reserve'/'document'), pas l'id numérique interne
    # de `ContentType` — c'est ce que consommerait un frontend, jamais un
    # détail d'implémentation Django.
    subject_type = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ['id', 'author', 'body', 'subject_type', 'subject_id', 'created_at']
        read_only_fields = fields

    def get_subject_type(self, message):
        return message.subject_type.model


class MessageCreateSerializer(serializers.Serializer):
    """Pas un `ModelSerializer` : `subject`/`organization`/`author` sont
    résolus par la vue appelante (`get_object()` du ViewSet du sujet, puis
    `request.user`), jamais fournis par le client — seul `body` est une
    saisie réelle.
    """

    body = serializers.CharField()
