from rest_framework import serializers

from apps.programs.models import Milestone

from . import services
from .models import Document, DocumentVisibility, Evidence, SensitivityLevel, WorkDeclaration


class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = [
            'id', 'category', 'visibility', 'sensitivity_level', 'hash', 'version',
            'source', 'captured_at', 'created_at', 'duplicate_of',
        ]
        read_only_fields = fields


class DocumentUploadSerializer(serializers.Serializer):
    """Pas un `ModelSerializer` : la création passe par
    `apps.evidence.services.create_document` (hash, éventuel déclenchement
    du traitement asynchrone), jamais par un simple `.save()` d'ORM.
    """

    file = serializers.FileField()
    category = serializers.CharField(max_length=100)
    source = serializers.CharField(max_length=100)
    visibility = serializers.ChoiceField(
        choices=DocumentVisibility.choices, default=DocumentVisibility.INTERNE,
    )
    sensitivity_level = serializers.ChoiceField(
        choices=SensitivityLevel.choices, default=SensitivityLevel.INTERNE,
    )
    captured_at = serializers.DateTimeField(required=False, allow_null=True)

    def create(self, validated_data):
        request = self.context['request']
        return services.create_document(
            organization=request.organization,
            owner=request.user,
            uploaded_file=validated_data['file'],
            category=validated_data['category'],
            source=validated_data['source'],
            visibility=validated_data['visibility'],
            sensitivity_level=validated_data['sensitivity_level'],
            captured_at=validated_data.get('captured_at'),
        )


class _OrganizationScopedFieldsMixin:
    def _active_organization(self):
        request = self.context.get('request')
        return getattr(request, 'organization', None) if request else None


class WorkDeclarationSerializer(_OrganizationScopedFieldsMixin, serializers.ModelSerializer):
    class Meta:
        model = WorkDeclaration
        fields = ['id', 'milestone', 'note', 'declared_by', 'created_at']
        read_only_fields = ['id', 'declared_by', 'created_at']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        organization = self._active_organization()
        self.fields['milestone'].queryset = (
            Milestone.objects.filter(organization=organization) if organization else Milestone.objects.none()
        )


class EvidenceSerializer(_OrganizationScopedFieldsMixin, serializers.ModelSerializer):
    class Meta:
        model = Evidence
        fields = ['id', 'work_declaration', 'documents', 'added_by', 'created_at']
        read_only_fields = ['id', 'added_by', 'created_at']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        organization = self._active_organization()
        self.fields['work_declaration'].queryset = (
            WorkDeclaration.objects.filter(organization=organization)
            if organization else WorkDeclaration.objects.none()
        )
        self.fields['documents'].queryset = (
            Document.objects.filter(organization=organization) if organization else Document.objects.none()
        )
