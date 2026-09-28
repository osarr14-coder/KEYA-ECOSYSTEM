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


def designated_pieces(organization_id, *, declaration_id=None, evidence_id=None):
    """PO-2026-09-28-20 — le contrôleur désigne EXPLICITEMENT les versions
    examinées. Les tests qui simulent un avis désignent ici toutes les
    pièces soumises de la déclaration (ou de la pièce visée), lues sous le
    contexte RLS de l'organisation du lot (laissé posé en sortie)."""
    from apps.core.rls import set_rls_context
    from apps.evidence.models import Evidence

    set_rls_context(organization_id=organization_id)
    if declaration_id is None:
        declaration_id = Evidence.objects.get(id=evidence_id).work_declaration_id
    return [
        str(evidence_id) for evidence_id in Evidence.objects.filter(
            work_declaration_id=declaration_id,
        ).order_by('created_at').values_list('id', flat=True)
    ]


def assign_mission(organization_id, declaration_id, *, inspector=None, inspector_client=None):
    """PO-2026-09-28-30 — un contrôleur n'agit que sur une mission qui lui
    est affectée. Les tests qui simulent un avis direct (`POST
    /api/inspections/`) affectent d'abord la mission, comme le gestionnaire
    dans le parcours réel. Le contrôleur est donné, ou retrouvé depuis le
    jeton du client de test. Laisse posé le contexte RLS de l'organisation."""
    from rest_framework_simplejwt.tokens import AccessToken

    from apps.accounts.models import User
    from apps.core.rls import set_rls_context

    from .models import InspectionMission

    if inspector is None:
        token = inspector_client._credentials['HTTP_AUTHORIZATION'].split()[1]
        inspector = User.objects.get(id=AccessToken(token)['user_id'])
    set_rls_context(organization_id=organization_id)
    mission, _created = InspectionMission.objects.get_or_create(
        organization_id=organization_id, work_declaration_id=declaration_id, assigned_inspector=inspector,
        defaults={'assigned_by': inspector},
    )
    return mission
