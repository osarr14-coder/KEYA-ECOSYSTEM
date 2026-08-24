from rest_framework import serializers

from .models import Task


class TaskSerializer(serializers.ModelSerializer):
    # Le type ContentType brut (un id numérique) ne dirait rien à un
    # client API — 'app_label.model' est directement lisible et filtrable,
    # cohérent avec le critère « types structurellement distincts ».
    subject_type = serializers.SerializerMethodField()

    # Ticket B-044 — `organization` exposé : l'appelant (frontend) doit
    # connaître l'organisation CIBLE d'une tâche pour pouvoir la compléter
    # en cross-org (`POST /api/tasks/{id}/admin-complete/
    # ?organization_id=<id>`), même besoin déjà couvert par
    # `ProgramRequestSerializer.organization` (ticket B-042).
    class Meta:
        model = Task
        fields = [
            'id', 'organization', 'type', 'subject_type', 'subject_id', 'program', 'assignee',
            'source', 'label', 'due_date', 'priority', 'status', 'created_at', 'completed_at',
        ]
        read_only_fields = fields

    def get_subject_type(self, task):
        return f'{task.subject_type.app_label}.{task.subject_type.model}'
