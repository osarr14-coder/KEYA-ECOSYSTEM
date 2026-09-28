from rest_framework import serializers

from apps.organizations.identity import actor_label

from .models import Message


class MessageSerializer(serializers.ModelSerializer):
    # PO-2026-09-28-36 : l'auteur s'affiche « organisation · rôle », jamais
    # par son e-mail (règle PO-2026-09-28-18 / -22 étendue à la messagerie).
    author = serializers.SerializerMethodField()
    # Label humain ('lot'/'reserve'/'document'), pas l'id numérique interne
    # de `ContentType` — c'est ce que consommerait un frontend, jamais un
    # détail d'implémentation Django.
    subject_type = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ['id', 'author', 'body', 'subject_type', 'subject_id', 'created_at']
        read_only_fields = fields

    def get_author(self, message):
        return actor_label(message.author)

    def get_subject_type(self, message):
        return message.subject_type.model


class MessageCreateSerializer(serializers.Serializer):
    """Pas un `ModelSerializer` : `subject`/`organization`/`author` sont
    résolus par la vue appelante (`get_object()` du ViewSet du sujet, puis
    `request.user`), jamais fournis par le client — seul `body` est une
    saisie réelle.
    """

    body = serializers.CharField()
