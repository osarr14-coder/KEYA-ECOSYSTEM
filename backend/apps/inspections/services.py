from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.rls import set_rls_context
from apps.evidence.models import Evidence, WorkDeclaration
from apps.organizations.models import Organization
from apps.trust import repository as trust_repository
from apps.trust.models import TrustLevel

from .models import Inspection, InspectionOutcome, Reserve, ReserveCorrection


class IndependenceRuleViolation(Exception):
    """L'inspecteur appartient à la même organisation que le lot inspecté —
    interdit par la règle d'indépendance du contrôle (ticket 005, V3.0 §2.3).
    """


def create_inspection(
    *, inspector, inspector_organization, target_organization_id,
    work_declaration_id=None, evidence_id=None, outcome, note='', reserve_id=None,
):
    """Point d'entrée unique pour créer une `Inspection` — et donc la SEULE
    façon de faire progresser le cycle de vie d'une `Reserve`
    (`ReserveViewSet` est en lecture seule, voir apps/inspections/views.py).

    `target_organization_id` est fourni explicitement par l'appelant : sans
    mécanisme d'affectation/dispatch (hors scope, voir ticket 006 Task
    Inbox), l'inspecteur est la seule partie qui sait quelle organisation il
    inspecte. Le contexte RLS est explicitement basculé vers cette
    organisation le temps de l'opération, puis restauré — même schéma que
    le bootstrap de `RegisterSerializer.create` (ticket 001) : une
    exception étroite et documentée, jamais un contournement général de
    RLS. Limite connue : l'inspecteur ne peut pas relire ses inspections
    passées via l'API (elles vivent dans l'organisation cible, pas la
    sienne) — nécessiterait une requête cross-organisation dédiée, hors
    scope de ce ticket.
    """
    if str(target_organization_id) == str(inspector_organization.id):
        raise IndependenceRuleViolation(
            "L'inspecteur ne peut pas inspecter un lot de sa propre organisation "
            "(règle d'indépendance du contrôle).",
        )

    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            inspection = _create_inspection_row(
                inspector=inspector,
                target_organization_id=target_organization_id,
                work_declaration_id=work_declaration_id,
                evidence_id=evidence_id,
                outcome=outcome,
                note=note,
                reserve_id=reserve_id,
            )
        finally:
            # Toujours restaurer le contexte de l'inspecteur avant de rendre
            # la main — le reste de la requête ne doit jamais continuer avec
            # un contexte RLS élevé, succès ou échec.
            set_rls_context(organization_id=inspector_organization.id)

    return inspection


def _create_inspection_row(*, inspector, target_organization_id, work_declaration_id,
                            evidence_id, outcome, note, reserve_id):
    target_organization = Organization.objects.filter(id=target_organization_id).first()
    if target_organization is None:
        raise ValidationError("organization cible introuvable.")

    work_declaration = None
    evidence = None
    if work_declaration_id:
        work_declaration = WorkDeclaration.objects.filter(
            id=work_declaration_id, organization=target_organization,
        ).first()
        if work_declaration is None:
            raise ValidationError("work_declaration introuvable dans l'organisation cible.")
        lot = work_declaration.milestone.lot
    else:
        evidence = Evidence.objects.filter(id=evidence_id, organization=target_organization).first()
        if evidence is None:
            raise ValidationError("evidence introuvable dans l'organisation cible.")
        lot = evidence.work_declaration.milestone.lot

    reserve = None
    if reserve_id:
        reserve = Reserve.objects.filter(id=reserve_id, organization=target_organization).first()
        if reserve is None:
            raise ValidationError("reserve introuvable dans l'organisation cible.")

    inspection = Inspection.objects.create(
        organization=target_organization,
        lot=lot,
        inspector=inspector,
        work_declaration=work_declaration,
        evidence=evidence,
        outcome=outcome,
        reserve=reserve,
        note=note,
    )

    inspection_level = TrustLevel.VERIFIE if outcome == InspectionOutcome.CONFORME else TrustLevel.CONTROLE
    trust_repository.create(
        subject=inspection, organization=target_organization, level=inspection_level,
        actor=inspector, source=f'inspection_{outcome}',
    )

    if reserve is not None:
        _advance_existing_reserve(
            reserve=reserve, outcome=outcome, inspector=inspector, organization=target_organization,
        )
    elif outcome == InspectionOutcome.AVEC_RESERVE:
        _open_new_reserve(inspection=inspection, inspector=inspector, organization=target_organization, lot=lot)

    return inspection


def _open_new_reserve(*, inspection, inspector, organization, lot):
    reserve = Reserve.objects.create(organization=organization, lot=lot, opened_by_inspection=inspection)
    trust_repository.create(
        subject=reserve, organization=organization, level=TrustLevel.CONTROLE,
        actor=inspector, source='ouverte',
    )

    # Ticket 006 : une réserve ouverte génère automatiquement une Task pour
    # le constructeur assigné au lot — via une vraie tâche Celery
    # asynchrone (.delay()), jamais un appel synchrone ici qui ne ferait que
    # ressembler à de l'asynchrone. Import différé : évite un cycle au
    # chargement (apps.tasks.tasks importe apps.inspections.models,
    # également en différé).
    from apps.tasks.tasks import process_reserve_opened

    process_reserve_opened.delay(
        reserve_id=str(reserve.id),
        organization_id=str(organization.id),
        actor_user_id=str(inspector.id),
    )

    return reserve


def _advance_existing_reserve(*, reserve, outcome, inspector, organization):
    trust_repository.create(
        subject=reserve, organization=organization, level=TrustLevel.CONTROLE,
        actor=inspector, source='nouvelle_inspection',
    )
    if outcome == InspectionOutcome.CONFORME:
        trust_repository.create(
            subject=reserve, organization=organization, level=TrustLevel.VALIDE,
            actor=inspector, source='levee',
        )
    else:
        trust_repository.create(
            subject=reserve, organization=organization, level=TrustLevel.CONTROLE,
            actor=inspector, source='rejetee',
        )


def create_reserve_correction(*, organization, reserve, evidence, submitted_by):
    """Action permise au constructeur : documenter une correction. Ne
    change jamais directement le statut de la réserve — génère un nouvel
    événement (`correction_proposee`) qui fait progresser sa chaîne,
    exactement comme toute autre action métier de ce projet (voir
    apps/programs/services.py pour le même schéma : une action métier
    normale qui a un effet de bord TrustEvent, jamais un endpoint qui
    fixerait un statut directement).
    """
    correction = ReserveCorrection.objects.create(
        organization=organization, reserve=reserve, evidence=evidence, submitted_by=submitted_by,
    )
    trust_repository.create(
        subject=reserve, organization=organization, level=TrustLevel.DOCUMENTE,
        actor=submitted_by, source='correction_proposee',
    )
    return correction


def get_reserve_status(reserve):
    """Le statut courant d'une réserve n'est jamais stocké — il se dérive du
    dernier `TrustEvent` de ce sujet (doctrine Visible Trust, CLAUDE.md).
    Retourne `None` si la réserve n'a pas encore d'événement (ne devrait pas
    arriver : `_open_new_reserve` en crée toujours un dans la même
    transaction que la création de la réserve).
    """
    current_event = trust_repository.get_current_status(reserve)
    return current_event.source if current_event else None


# Un statut dérivé (voir get_reserve_status) parmi ces sources signifie que
# la réserve n'est pas encore résolue — `levee`/`rejetee` sont les deux
# seules sorties terminales (voir _advance_existing_reserve ci-dessus).
# Propriété du domaine Reserve lui-même : centralisé ici plutôt que dans
# apps.home ou apps.build pour que les deux (et tout futur consommateur)
# partagent exactement la même définition, jamais deux copies qui pourraient
# diverger. Déplacé depuis apps/home/services.py au ticket 009, quand un
# second consommateur (apps/build) en a eu besoin.
OPEN_RESERVE_STATUSES = {'ouverte', 'correction_proposee', 'nouvelle_inspection'}


def is_reserve_open(reserve):
    return get_reserve_status(reserve) in OPEN_RESERVE_STATUSES
