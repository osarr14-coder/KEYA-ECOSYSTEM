import logging

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.rls import set_rls_context
from apps.evidence.models import Document, WorkDeclaration
from apps.evidence.services import create_document, create_evidence
from apps.inspections import services as inspections_services
from apps.organizations.models import Organization

logger = logging.getLogger(__name__)


def sync_document(
    *, inspector, inspector_organization, target_organization_id,
    uploaded_file, category, source, captured_at=None, correlation_id=None,
):
    """Un inspecteur n'est jamais membre de l'organisation cible (règle
    d'indépendance du contrôle, ticket 005) — `apps.evidence.services.
    create_document` ne bascule pas lui-même le contexte RLS (il suppose un
    appelant déjà dans la bonne organisation, vrai pour tout appelant
    existant avant ce ticket). Même schéma que `apps.inspections.services.
    create_inspection` : bascule explicite vers l'organisation cible, restaurée
    dans un `finally`, jamais de contournement général de RLS.
    """
    logger.info(
        'control_sync_document_received correlation_id=%s target_organization_id=%s',
        correlation_id, target_organization_id,
    )
    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            target_organization = Organization.objects.filter(id=target_organization_id).first()
            if target_organization is None:
                raise ValidationError("organization cible introuvable.")
            document = create_document(
                organization=target_organization,
                owner=inspector,
                uploaded_file=uploaded_file,
                category=category,
                source=source,
                captured_at=captured_at,
            )
        finally:
            set_rls_context(organization_id=inspector_organization.id)
    logger.info(
        'control_sync_document_applied correlation_id=%s document_id=%s', correlation_id, document.id,
    )
    return document


def sync_evidence(
    *, inspector, inspector_organization, target_organization_id,
    work_declaration_id, document_ids, correlation_id=None,
):
    logger.info(
        'control_sync_evidence_received correlation_id=%s target_organization_id=%s',
        correlation_id, target_organization_id,
    )
    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            target_organization = Organization.objects.filter(id=target_organization_id).first()
            if target_organization is None:
                raise ValidationError("organization cible introuvable.")
            work_declaration = WorkDeclaration.objects.filter(
                id=work_declaration_id, organization=target_organization,
            ).first()
            if work_declaration is None:
                raise ValidationError("work_declaration introuvable dans l'organisation cible.")
            documents = list(Document.objects.filter(id__in=document_ids, organization=target_organization))
            if len(documents) != len(set(document_ids)):
                raise ValidationError("un ou plusieurs documents sont introuvables dans l'organisation cible.")
            evidence = create_evidence(
                organization=target_organization,
                work_declaration=work_declaration,
                documents=documents,
                added_by=inspector,
            )
        finally:
            set_rls_context(organization_id=inspector_organization.id)
    logger.info(
        'control_sync_evidence_applied correlation_id=%s evidence_id=%s', correlation_id, evidence.id,
    )
    return evidence


class SyncOutcome:
    """Résultat de `sync_inspection` : soit `applied` (avec l'Inspection
    créée), soit `conflict` (rien n'a été créé — voir `SyncConflict`).
    Un objet dédié plutôt qu'un tuple : la vue n'a jamais à deviner l'ordre
    des champs, et un futur statut supplémentaire n'oblige pas à changer la
    forme de l'appel.
    """

    def __init__(self, *, status, inspection=None, current_event=None, latest_event_id=None):
        self.status = status
        self.inspection = inspection
        self.current_event = current_event
        # Ticket 013 (bug 2) : ce que le client doit renvoyer comme
        # `known_latest_event_id` pour toute synchro suivante légitime sur
        # cette même cible — voir `inspections_services._create_inspection_row`.
        self.latest_event_id = latest_event_id


def sync_inspection(
    *, inspector, inspector_organization, target_organization_id,
    work_declaration_id, outcome, note, correlation_id, known_latest_event_id=None, reserve_id=None,
    reserves=None, decisions=None,
):
    """Point d'entrée CONTROL pour synchroniser une inspection saisie hors
    ligne. Délègue entièrement à `apps.inspections.services.create_inspection`
    (déjà validé, tickets 003/005) — n'ajoute que la détection de conflit
    (`expected_latest_event_id`) et le correlation ID, tous deux déjà portés
    par cette fonction (voir son propre docstring pour l'atomicité de la
    vérification).

    `known_latest_event_id` vaut `None` pour tout brouillon saisi
    intégralement hors ligne (aucun appel réseau n'a encore eu lieu, passe 1)
    — un premier envoi réussit donc toujours tant que personne d'autre n'a
    déjà écrit sur la même cible depuis. C'est exactement ce qui rend le
    scénario de conflit testable : deux brouillons indépendants, tous deux
    avec `known_latest_event_id=None`, où seul le premier à synchroniser
    l'emporte — voir apps/control/tests.py.
    """
    logger.info(
        'control_sync_inspection_received correlation_id=%s target_organization_id=%s '
        'known_latest_event_id=%s', correlation_id, target_organization_id, known_latest_event_id,
    )
    try:
        inspection = inspections_services.create_inspection(
            inspector=inspector,
            inspector_organization=inspector_organization,
            target_organization_id=target_organization_id,
            work_declaration_id=work_declaration_id,
            outcome=outcome,
            note=note,
            reserve_id=reserve_id,
            expected_latest_event_id=known_latest_event_id,
            client_correlation_id=correlation_id,
            reserves=reserves,
            decisions=decisions,
        )
    except inspections_services.SyncConflict as exc:
        logger.warning('control_sync_inspection_conflict correlation_id=%s', correlation_id)
        return SyncOutcome(status='conflict', current_event=exc.current_event)

    logger.info(
        'control_sync_inspection_applied correlation_id=%s inspection_id=%s',
        correlation_id, inspection.id,
    )
    return SyncOutcome(status='applied', inspection=inspection, latest_event_id=str(inspection.latest_event_id))


# ─── Audit UI R1 (K01–K04) : avis EN LIGNE sur une mission ────────────────

class MissionNotFound(Exception):
    """Mission inexistante, d'une autre instance ou affectée à un autre
    contrôleur — toujours 404, jamais une indication d'existence."""


class MissionAlreadyCompleted(Exception):
    """L'avis de cette mission est déjà enregistré (409)."""


def _mission_for(inspector, mission_id):
    from apps.inspections.models import InspectionMission

    # Lisible sous le contexte du contrôleur grâce à la branche
    # `assigned_inspector_id = current_user` de la policy RLS (inspections
    # 0006). JAMAIS de jointure vers lot/programme ici : sous ce contexte,
    # RLS éliminerait la ligne (voir `list_missions_for_inspector`).
    mission = InspectionMission.objects.filter(id=mission_id, assigned_inspector=inspector).first()
    if mission is None:
        raise MissionNotFound()
    return mission


def _check_active_instance(mission):
    """Audit UI R1 (D01), sous le contexte RLS de l'organisation de la
    mission : une mission hors de l'instance active n'existe pas (404)."""
    if not inspections_services.mission_in_active_instance(mission):
        raise MissionNotFound()


def _mission_flags(mission, inspector):
    from apps.inspections.models import Inspection

    inspections = Inspection.objects.filter(work_declaration_id=mission.work_declaration_id)
    completed = inspections.filter(inspector=inspector, created_at__gt=mission.created_at).exists()
    follow_up = inspections.filter(created_at__lte=mission.created_at).exists()
    return completed, follow_up


def mission_detail(*, inspector, caller_organization_id, mission_id):
    """K01 : déclaration du constructeur, pièces soumises par version
    (fichier, déposant, date) et réserves ouvertes à trancher (K03)."""
    from apps.evidence.models import Evidence
    from apps.inspections.models import ReserveCorrection

    mission = _mission_for(inspector, mission_id)
    set_rls_context(organization_id=mission.organization_id)
    try:
        _check_active_instance(mission)
        declaration = mission.work_declaration
        lot = declaration.milestone.lot
        completed, follow_up = _mission_flags(mission, inspector)
        evidences = []
        for version, evidence in enumerate(
            Evidence.objects.filter(work_declaration=declaration).select_related('added_by').order_by('created_at'),
            start=1,
        ):
            evidences.append({
                'id': str(evidence.id),
                'version': version,
                'added_by': evidence.added_by.email,
                'added_at': evidence.created_at.isoformat(),
                'documents': [
                    {
                        'id': str(document.id), 'file_name': document.file.name.rsplit('/', 1)[-1],
                        'sha256': document.hash,
                    }
                    for document in evidence.documents.order_by('created_at')
                ],
            })
        open_reserves = []
        for reserve in inspections_services._open_reserves_of(declaration).values():
            status = inspections_services.get_reserve_status(reserve)
            open_reserves.append({
                'id': str(reserve.id),
                'motif': reserve.motif or reserve.description or 'Réserve',
                'expected_action': reserve.expected_action,
                'opened_at': reserve.created_at.isoformat(),
                'status': status,
                'status_label': inspections_services.RESERVE_STATUS_LABELS.get(status, status or ''),
                'corrections': [
                    {'submitted_at': correction.created_at.isoformat(), 'submitted_by': correction.submitted_by.email}
                    for correction in ReserveCorrection.objects.filter(reserve=reserve).select_related(
                        'submitted_by',
                    ).order_by('created_at')
                ],
            })
        return {
            'id': str(mission.id),
            'lot_name': lot.name,
            'asset_name': lot.asset.name,
            'program_name': lot.asset.program.name,
            'milestone_label': declaration.milestone.label,
            'completed': completed,
            'follow_up': follow_up,
            'declaration': {
                'id': str(declaration.id),
                'declared_by': declaration.declared_by.email,
                'declared_at': declaration.created_at.isoformat(),
                'note': declaration.note,
            },
            'evidences': evidences,
            'open_reserves': open_reserves,
            # PO-2026-09-28-04 : niveaux atteints du jalon contrôlé.
            'trust_levels': inspections_services.milestone_trust_levels(declaration.milestone),
        }
    finally:
        set_rls_context(organization_id=caller_organization_id)


def submit_opinion(*, inspector, inspector_organization, mission_id, outcome, note, reserves, decisions,
                   examined_evidence_ids):
    """K01–K04 : avis EN LIGNE, horodaté par le serveur. Toutes les règles
    (réserves structurées, décision explicite par réserve, versions
    examinées) sont celles de `inspections_services.create_inspection`."""
    mission = _mission_for(inspector, mission_id)
    set_rls_context(organization_id=mission.organization_id)
    try:
        _check_active_instance(mission)
        completed, _follow_up = _mission_flags(mission, inspector)
    finally:
        set_rls_context(organization_id=inspector_organization.id)
    if completed:
        raise MissionAlreadyCompleted()
    return inspections_services.create_inspection(
        inspector=inspector,
        inspector_organization=inspector_organization,
        target_organization_id=mission.organization_id,
        work_declaration_id=mission.work_declaration_id,
        outcome=outcome,
        note=note,
        reserves=reserves,
        decisions=decisions,
        examined_evidence_ids=examined_evidence_ids,
    )


def mission_document(*, inspector, caller_organization_id, mission_id, document_id):
    """K01 : une pièce soumise, lisible par le SEUL contrôleur affecté à la
    mission, et seulement si elle appartient à la déclaration contrôlée.
    Retourne `(nom de fichier, fichier ouvert)`."""
    mission = _mission_for(inspector, mission_id)
    set_rls_context(organization_id=mission.organization_id)
    try:
        _check_active_instance(mission)
        document = Document.objects.filter(
            id=document_id, organization_id=mission.organization_id,
            evidences__work_declaration_id=mission.work_declaration_id,
        ).first()
        if document is None:
            raise MissionNotFound()
        return document.file.name.rsplit('/', 1)[-1], document.file.open('rb')
    finally:
        set_rls_context(organization_id=caller_organization_id)
