from rest_framework import serializers

from apps.inspections.models import InspectionOutcome


class SyncDocumentSerializer(serializers.Serializer):
    """Un item de la file média (ticket 010, passe 2) : une photo, envoyée
    seule — jamais couplée à la synchronisation des données de l'inspection,
    pour que l'échec de l'une ne bloque jamais l'autre (voir CLAUDE.md,
    section CONTROL PWA, addendum passe 2).
    """

    organization = serializers.UUIDField()
    file = serializers.FileField()
    category = serializers.CharField(max_length=100)
    source = serializers.CharField(max_length=100)
    captured_at = serializers.DateTimeField(required=False, allow_null=True)
    correlation_id = serializers.UUIDField()


class SyncEvidenceSerializer(serializers.Serializer):
    organization = serializers.UUIDField()
    work_declaration = serializers.UUIDField()
    documents = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    correlation_id = serializers.UUIDField()


class SyncInspectionSerializer(serializers.Serializer):
    """Cible toujours `work_declaration` (jamais `evidence`) : les photos de
    l'inspecteur transitent par leur propre `Evidence`, synchronisée
    séparément via `SyncEvidenceSerializer` — la checklist/le commentaire/la
    décision ne dépendent jamais de la réussite d'un upload photo.
    """

    organization = serializers.UUIDField()
    work_declaration = serializers.UUIDField()
    outcome = serializers.ChoiceField(choices=InspectionOutcome.choices)
    note = serializers.CharField(required=False, allow_blank=True, default='')
    reserve = serializers.UUIDField(required=False, allow_null=True)
    correlation_id = serializers.UUIDField()
    # `None` (absent du payload JSON) est une valeur légitime : "le client
    # n'a jamais observé le moindre événement pour cette cible" — distinct
    # d'un champ manquant par erreur, donc jamais `required=False` seul :
    # `allow_null=True` accepte explicitement `null` en JSON.
    known_latest_event_id = serializers.UUIDField(required=False, allow_null=True, default=None)
