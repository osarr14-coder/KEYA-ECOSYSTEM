import hashlib

from apps.trust import repository as trust_repository
from apps.trust.models import TrustLevel

from .models import Document, DocumentVisibility, Evidence, SensitivityLevel, WorkDeclaration
from .tasks import process_document_media

IMAGE_CONTENT_TYPES = {'image/jpeg', 'image/png', 'image/webp'}


def create_document(
    *, organization, owner, uploaded_file, category, source,
    visibility=DocumentVisibility.INTERNE, sensitivity_level=SensitivityLevel.INTERNE,
    captured_at=None,
):
    digest = hashlib.sha256()
    for chunk in uploaded_file.chunks():
        digest.update(chunk)
    uploaded_file.seek(0)

    document = Document.objects.create(
        organization=organization,
        owner=owner,
        category=category,
        source=source,
        captured_at=captured_at,
        visibility=visibility,
        sensitivity_level=sensitivity_level,
        hash=digest.hexdigest(),
        file=uploaded_file,
    )

    if getattr(uploaded_file, 'content_type', None) in IMAGE_CONTENT_TYPES:
        process_document_media.delay(str(document.id))

    return document


def create_work_declaration(*, organization, milestone, declared_by, note=''):
    """Génère un `TrustEvent` de niveau déclaré dont le sujet est la
    déclaration elle-même (pas le Milestone) — voir apps/trust/models.py :
    chaque type d'objet métier a sa propre chaîne de provenance.
    """
    declaration = WorkDeclaration.objects.create(
        organization=organization, milestone=milestone, declared_by=declared_by, note=note,
    )
    trust_repository.create(
        subject=declaration, organization=organization, level=TrustLevel.DECLARE,
        actor=declared_by, source='work_declaration',
    )
    return declaration


def create_evidence(*, organization, work_declaration, documents, added_by):
    """Génère un `TrustEvent` de niveau documenté distinct de celui de la
    déclaration — critère d'acceptation ticket 004 : jamais fusionnés.
    """
    evidence = Evidence.objects.create(
        organization=organization, work_declaration=work_declaration, added_by=added_by,
    )
    evidence.documents.set(documents)
    trust_repository.create(
        subject=evidence, organization=organization, level=TrustLevel.DOCUMENTE,
        actor=added_by, source='evidence_upload',
    )
    return evidence
