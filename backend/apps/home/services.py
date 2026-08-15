"""Agrégation en lecture seule pour HOME (ticket 008).

Aucune valeur affichée par le frontend n'est calculée côté React — tout ce
qui ressemble à un pourcentage ou à un statut est calculé ICI, côté backend,
et exposé tel quel par `apps/home/views.py`. Le frontend ne fait que rendre
ce qu'il reçoit.

Le statut courant d'un `Milestone` n'est stocké nulle part (doctrine Visible
Trust) — et `Milestone` lui-même ne porte jamais directement de `TrustEvent`
dans ce projet (voir apps/evidence/services.py et apps/inspections/services.py) :
les événements portent sur `WorkDeclaration`, `Evidence`, `Inspection`,
`Reserve`. Le statut d'un jalon se dérive donc du dernier événement parmi
TOUTE la chaîne d'objets qui s'y rattachent transitivement.
"""

from django.contrib.contenttypes.models import ContentType
from django.db.models import Q

from apps.evidence.models import Evidence, WorkDeclaration
from apps.inspections.models import Inspection, Reserve
from apps.inspections.services import OPEN_RESERVE_STATUSES, get_reserve_status
from apps.programs.models import Lot, LotClient
from apps.trust import repository as trust_repository
from apps.trust.models import TrustEvent
from apps.trust.services import LEVEL_PROGRESS_FRACTION


def get_client_lots(user):
    """Tous les `Lot` explicitement assignés à ce client — jamais tous les
    lots de son organisation (voir `LotClient`, critère de sécurité central
    du ticket 008).
    """
    return (
        Lot.objects.filter(client_assignments__client=user)
        .select_related('asset', 'asset__program')
        .distinct()
        .order_by('name')
    )


def get_client_lot_or_none(user, lot_id):
    """Résout un `Lot` UNIQUEMENT si une `LotClient` explicite l'assigne à ce
    user — jamais par appartenance d'organisation seule (RLS reste un filet
    de sécurité en plus, jamais le seul filtre, même logique que
    `apps.tasks.views.MyTasksView`, ticket 006).
    """
    assignment = (
        LotClient.objects.filter(client=user, lot_id=lot_id)
        .select_related('lot', 'lot__asset', 'lot__asset__program')
        .first()
    )
    return assignment.lot if assignment else None


def _serialize_event(event):
    """Même forme que `apps/trust/repository.py::get_current_status` —
    directement consommable par le popover `StatusBadge` du design system
    (ticket 007) : level/source/actor/scope/createdAt, rien de calculé.
    """
    if event is None:
        return None
    return {
        'level': event.level,
        'source': event.source,
        'actor': event.actor.email,
        'scope': event.scope,
        'created_at': event.created_at.isoformat(),
    }


def _milestone_trust_events_queryset(milestone):
    work_declaration_ct = ContentType.objects.get_for_model(WorkDeclaration)
    evidence_ct = ContentType.objects.get_for_model(Evidence)
    inspection_ct = ContentType.objects.get_for_model(Inspection)

    work_declaration_ids = WorkDeclaration.objects.filter(milestone=milestone).values_list('id', flat=True)
    evidence_ids = Evidence.objects.filter(work_declaration__milestone=milestone).values_list('id', flat=True)
    inspection_ids = Inspection.objects.filter(
        Q(work_declaration__milestone=milestone) | Q(evidence__work_declaration__milestone=milestone),
    ).values_list('id', flat=True)

    return TrustEvent.objects.filter(
        Q(subject_type=work_declaration_ct, subject_id__in=work_declaration_ids)
        | Q(subject_type=evidence_ct, subject_id__in=evidence_ids)
        | Q(subject_type=inspection_ct, subject_id__in=inspection_ids),
    )


def compute_milestone_status(milestone):
    """Le dernier `TrustEvent` parmi tout ce qui se rattache à ce jalon —
    `None` si le jalon n'a encore reçu aucune déclaration/preuve/inspection.
    """
    return _milestone_trust_events_queryset(milestone).select_related('actor').order_by('-created_at').first()


def compute_lot_progress(lot):
    """Calcule TOUT côté backend — pourcentage inclus (arrondi ici, pas dans
    le frontend) — voir LEVEL_PROGRESS_FRACTION pour la formule.
    """
    milestones = list(lot.milestones.order_by('order'))
    milestone_statuses = []
    total_fraction = 0

    for milestone in milestones:
        latest_event = compute_milestone_status(milestone)
        level = latest_event.level if latest_event else None
        total_fraction += LEVEL_PROGRESS_FRACTION[level]
        milestone_statuses.append({
            'id': str(milestone.id),
            'code': milestone.code,
            'label': milestone.label,
            'order': milestone.order,
            'level': level,
            'event': _serialize_event(latest_event),
        })

    percentage = round(total_fraction / len(milestone_statuses)) if milestone_statuses else 0
    return {'percentage': percentage, 'milestones': milestone_statuses}


def _lot_trust_events_queryset(lot):
    work_declaration_ct = ContentType.objects.get_for_model(WorkDeclaration)
    evidence_ct = ContentType.objects.get_for_model(Evidence)
    inspection_ct = ContentType.objects.get_for_model(Inspection)
    reserve_ct = ContentType.objects.get_for_model(Reserve)

    work_declaration_ids = WorkDeclaration.objects.filter(milestone__lot=lot).values_list('id', flat=True)
    evidence_ids = Evidence.objects.filter(work_declaration__milestone__lot=lot).values_list('id', flat=True)
    inspection_ids = Inspection.objects.filter(lot=lot).values_list('id', flat=True)
    reserve_ids = Reserve.objects.filter(lot=lot).values_list('id', flat=True)

    return TrustEvent.objects.filter(
        Q(subject_type=work_declaration_ct, subject_id__in=work_declaration_ids)
        | Q(subject_type=evidence_ct, subject_id__in=evidence_ids)
        | Q(subject_type=inspection_ct, subject_id__in=inspection_ids)
        | Q(subject_type=reserve_ct, subject_id__in=reserve_ids),
    )


def get_latest_notable_event(lot):
    """L'événement le plus récent, tous types confondus, parmi tout ce qui
    se rattache à ce lot — « dernier événement notable » du ticket 008.
    """
    return _lot_trust_events_queryset(lot).select_related('actor').order_by('-created_at').first()


def get_open_reserve(lot):
    """La réserve ouverte la plus récente non résolue — le « problème
    principal » du critère produit 26.1 cité par le ticket 008, s'il existe.
    """
    for reserve in lot.reserves.order_by('-created_at'):
        if get_reserve_status(reserve) in OPEN_RESERVE_STATUSES:
            return reserve
    return None


def build_lot_overview(lot):
    """Payload complet de la vue « Vue d'ensemble » — un dict déjà
    JSON-sérialisable (UUID/datetime convertis ici), rien à recalculer côté
    frontend.
    """
    progress = compute_lot_progress(lot)
    latest_event = get_latest_notable_event(lot)
    open_reserve = get_open_reserve(lot)

    return {
        'lot_id': str(lot.id),
        'lot_name': lot.name,
        'asset_name': lot.asset.name,
        'asset_location': lot.asset.location,
        'program_name': lot.asset.program.name,
        'progress_percentage': progress['percentage'],
        'milestones': progress['milestones'],
        'latest_notable_event': _serialize_event(latest_event),
        'open_reserve': {
            'id': str(open_reserve.id),
            'status': get_reserve_status(open_reserve),
            'description': open_reserve.description,
        } if open_reserve else None,
    }


def build_lot_evidence_feed(lot):
    """Payload de la vue « Avancement & preuves » — liste chronologique
    (plus récent en premier), chaque item déjà accompagné de son statut
    (`StatusBadge`) et de sa provenance.
    """
    evidences = (
        Evidence.objects.filter(work_declaration__milestone__lot=lot)
        .select_related('work_declaration', 'work_declaration__milestone', 'added_by')
        .prefetch_related('documents')
        .order_by('-created_at')
    )

    feed = []
    for evidence in evidences:
        event = trust_repository.get_current_status(evidence)
        feed.append({
            'id': str(evidence.id),
            'milestone_code': evidence.work_declaration.milestone.code,
            'milestone_label': evidence.work_declaration.milestone.label,
            'added_by': evidence.added_by.email,
            'created_at': evidence.created_at.isoformat(),
            'document_count': evidence.documents.count(),
            'documents': [
                {
                    'category': document.category,
                    'source': document.source,
                    'captured_at': document.captured_at.isoformat() if document.captured_at else None,
                }
                for document in evidence.documents.all()
            ],
            'status': _serialize_event(event),
        })
    return feed
