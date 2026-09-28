"""Aide aux tests — PO-2026-09-28-13 (K01, CDC §7.2) : un avis désigne au
moins une version de pièce soumise pour la déclaration. Les fixtures qui
préparent une déclaration « prête à être inspectée » y joignent donc une
pièce, comme le fait le constructeur dans le parcours réel.

Module sans test (jamais importé par le code applicatif)."""

from django.core.files.uploadedfile import SimpleUploadedFile

from apps.evidence.services import create_document, create_evidence


def submit_evidence(*, organization, declaration, added_by, content=b'photo de chantier'):
    """Dépose une pièce (un document) pour `declaration`, sous le contexte
    RLS courant — celui de l'organisation du constructeur."""
    uploaded = SimpleUploadedFile('piece.txt', content, content_type='text/plain')
    document = create_document(
        organization=organization, owner=added_by, uploaded_file=uploaded,
        category='rapport_chantier', source='mobile_app_photo',
    )
    return create_evidence(
        organization=organization, work_declaration=declaration, documents=[document], added_by=added_by,
    )
