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
        )
    except inspections_services.SyncConflict as exc:
        logger.warning('control_sync_inspection_conflict correlation_id=%s', correlation_id)
        return SyncOutcome(status='conflict', current_event=exc.current_event)

    logger.info(
        'control_sync_inspection_applied correlation_id=%s inspection_id=%s',
        correlation_id, inspection.id,
    )
    return SyncOutcome(status='applied', inspection=inspection, latest_event_id=str(inspection.latest_event_id))
