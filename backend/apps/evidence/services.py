import hashlib

from rest_framework.exceptions import ValidationError

from apps.trust import repository as trust_repository
from apps.trust.models import TrustLevel

from .models import AntivirusStatus, Document, DocumentVisibility, Evidence, SensitivityLevel, WorkDeclaration
from .scanning import ACCEPTED_WITHOUT_ANTIVIRUS, ensure_scanned
from .tasks import process_document_media
from .validators import EXTENSION_BY_KIND, IMAGE_KINDS, detect_document_kind


def create_document(
    *, organization, owner, uploaded_file, category, source,
    visibility=DocumentVisibility.INTERNE, sensitivity_level=SensitivityLevel.INTERNE,
    captured_at=None,
):
    digest = hashlib.sha256()
    for chunk in uploaded_file.chunks():
        digest.update(chunk)
    uploaded_file.seek(0)
    file_hash = digest.hexdigest()

    # Doublon exact (ticket B-040) — toujours le plus ancien Document de
    # l'organisation portant ce hash, pas le doublon le plus récent : une
    # chaîne de 3 uploads identiques pointe les 2e et 3e vers le 1er,
    # jamais le 3e vers le 2e. Comparaison strictement intra-organisation
    # (deux organisations différentes peuvent légitimement partager un même
    # fichier, ex. un formulaire officiel — pas un signal de fraude en soi).
    duplicate_of = Document.objects.filter(
        organization=organization, hash=file_hash,
    ).order_by('created_at').first()

    # Ticket B-047 — extension et traitement média décidés par le type
    # DÉTECTÉ, jamais par le nom ou le Content-Type fournis par le client :
    # un `facture.bat` commençant par `%PDF-` était stocké et téléchargé en
    # `.bat`, et une photo déclarée `application/pdf` échappait au
    # ré-encodage (métadonnées EXIF/GPS conservées). Type non détecté (seuls
    # des appels directs au service, hors HTTP, peuvent l'atteindre — les
    # deux chemins HTTP valident d'abord) : aucune extension.
    kind = detect_document_kind(uploaded_file)
    # PO-2026-09-29-13 (T15) : aucun fichier stocké sans analyse — déjà
    # faite par les deux chemins de dépôt HTTP, faite ici pour tout autre
    # appelant.
    ensure_scanned(uploaded_file, kind)
    uploaded_file.name = f'document.{EXTENSION_BY_KIND[kind]}' if kind else 'document'

    document = Document.objects.create(
        organization=organization,
        owner=owner,
        category=category,
        source=source,
        captured_at=captured_at,
        visibility=visibility,
        sensitivity_level=sensitivity_level,
        hash=file_hash,
        duplicate_of=duplicate_of,
        file=uploaded_file,
        antivirus_status=uploaded_file.keya_antivirus_status,
    )
    if document.antivirus_status == AntivirusStatus.NON_ANALYSE:
        # PO-2026-09-30-07 : chaque dépôt accepté sans antivirus (dérogation
        # de la DÉMO) est tracé, avec son empreinte, pour être repassé au
        # moteur dès qu'il sera branché.
        from apps.audit import services as audit_services

        audit_services.record(
            organization_id=organization.id, actor=owner, action=ACCEPTED_WITHOUT_ANTIVIRUS, obj=document,
            payload={'sha256': file_hash, 'size': uploaded_file.size, 'kind': kind or '', 'derogation': 'PO-2026-09-30-07'},
        )

    if kind in IMAGE_KINDS:
        # organization_id/owner sont transmis explicitement : un worker
        # Celery réel n'a aucune requête HTTP pour les résoudre lui-même
        # (voir apps/evidence/tasks.py et docs/adr/0001-celery-eager-mode.md).
        process_document_media.delay(
            document_id=str(document.id),
            organization_id=str(document.organization_id),
            requested_by_user_id=str(owner.id),
        )

    return document


def create_work_declaration(*, organization, milestone, declared_by, note=''):
    """Génère un `TrustEvent` de niveau déclaré dont le sujet est la
    déclaration elle-même (pas le Milestone) — voir apps/trust/models.py :
    chaque type d'objet métier a sa propre chaîne de provenance.
    """
    # PO-2026-09-29-09 : pas de chantier avant la concrétisation du dossier.
    # Tout ce qui suit (pièces, contrôle, acceptation, décaissement) part
    # d'une déclaration : refuser ici ferme toute la chaîne.
    from apps.sales.services import CHANTIER_NOT_OPEN_MESSAGE, lot_chantier_is_open

    if not lot_chantier_is_open(lot_id=milestone.lot_id, lot_organization_id=milestone.organization_id):
        raise ValidationError({'milestone': [CHANTIER_NOT_OPEN_MESSAGE]})
    declaration = WorkDeclaration.objects.create(
        organization=organization, milestone=milestone, declared_by=declared_by, note=note,
    )
    trust_repository.create(
        subject=declaration, organization=organization, level=TrustLevel.DECLARE,
        actor=declared_by, source='work_declaration',
    )
    return declaration


def create_evidence(*, organization, work_declaration, documents, added_by, required_piece=''):
    """Génère un `TrustEvent` de niveau documenté distinct de celui de la
    déclaration — critère d'acceptation ticket 004 : jamais fusionnés.
    `required_piece` (PO-2026-09-28-63) : pièce exigée du jalon à laquelle
    répond ce dépôt, vide pour « Autre pièce ».
    """
    evidence = Evidence.objects.create(
        organization=organization, work_declaration=work_declaration, added_by=added_by,
        required_piece=required_piece or '',
    )
    evidence.documents.set(documents)
    trust_repository.create(
        subject=evidence, organization=organization, level=TrustLevel.DOCUMENTE,
        actor=added_by, source='evidence_upload',
    )
    # PO-2026-09-28-44 (R2, R4) : jalon soumis → affectation du contrôle ;
    # pièce ajoutée après acceptation → nouvelle revue (T07).
    from apps.tasks.relays import sync_lot_relays

    sync_lot_relays(work_declaration.milestone.lot, actor=added_by)
    return evidence
