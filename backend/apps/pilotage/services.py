"""Lot 4 — pilotage minimal (PO-2026-09-28-46, CDC §9.2 étape 10, §9.3).

Indicateurs calculés sur l'instance active seulement (`demo_scope` : les
archives et les objets hors scénario sont exclus), chacun avec la liste de
ses sources. Tout est DÉRIVÉ des objets métier et des journaux, rien n'est
stocké. Un dénominateur nul est rendu tel quel : l'écran affiche « Non
applicable », jamais 100 %.

Chaque lot est lu sous le contexte RLS de SON organisation (même boucle que
`apps.sales.services.list_reservations_as_admin`), restauré à la fin.
"""
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from apps.core.demo import demo_scope
from apps.core.rls import set_rls_context
from apps.inspections import services as inspections
from apps.inspections.models import InspectionOutcome, Reserve
from apps.organizations.identity import actor_label
from apps.organizations.models import Organization
from apps.programs.models import Lot
from apps.sales.models import (
    CustomerReceipt, Disbursement, DisbursementFlowStatus, DisbursementStatus, FlowStatus, Reservation,
    ReservationStatus,
)
from apps.trust import repository as trust_repository

INDICATOR_KEYS = ('jalons', 'entrees', 'sorties', 'reserves', 'pieces')
ACTIVE_RESERVATION_STATUSES = (ReservationStatus.HELD, ReservationStatus.RESERVED, ReservationStatus.COMMITTED)
RESERVE_LIFTED = 'levee'


def _days_between(start, end):
    return max(0, (end - start).days)


def _lot_dossier(lot):
    """Dossier en cours sur le lot (pour ouvrir la source), `None` sinon."""
    reservation = (
        Reservation.objects.filter(lot=lot, status__in=ACTIVE_RESERVATION_STATUSES)
        .select_related('client').order_by('-created_at').first()
    )
    if reservation is None:
        return None
    return {'id': str(reservation.id), 'organization_id': str(reservation.organization_id)}


def _milestone_of_reserve(reserve):
    inspection = reserve.opened_by_inspection
    declaration = inspection.work_declaration or (inspection.evidence.work_declaration if inspection.evidence_id else None)
    return declaration.milestone if declaration else None


def _collect_lot(lot, now, sources, cache):
    program = lot.asset.program
    dossier = _lot_dossier(lot)
    where = {'program': program.name, 'lot': lot.name, 'dossier': dossier}

    for milestone in lot.milestones.order_by('order'):
        milestone.lot = lot
        state = inspections.milestone_control_state(milestone)
        declaration = state['declaration']
        if declaration is None:
            continue
        code, status_label, _hint = inspections.milestone_cdc_state(state)
        # PO-2026-09-28-64 : un jalon déclaré exige ses pièces.
        for piece in inspections.milestone_required_pieces(milestone, declaration):
            sources['pieces'].append({**where, 'milestone': milestone.label, **piece})
        if state['evidence_count'] == 0:
            continue
        # PO-2026-09-28-65 : soumis = déclaration courante avec une pièce ;
        # examiné = au moins un avis sur cette déclaration.
        last = inspections._declaration_inspections(declaration).select_related('inspector').order_by('-created_at').first()
        sources['jalons'].append({
            **where, 'milestone': milestone.label, 'cdc_state': code, 'status_label': status_label,
            'examined': last is not None,
            'technically_accepted': state['status'] == inspections.ACCEPTED,
            'last_opinion': None if last is None else {
                'outcome': last.outcome, 'outcome_label': InspectionOutcome(last.outcome).label,
                'at': last.created_at.isoformat(), 'by': actor_label(last.inspector, 'inspecteur', cache),
            },
        })

    for reserve in Reserve.objects.filter(lot=lot).select_related(
        'opened_by_inspection__inspector', 'opened_by_inspection__work_declaration__milestone',
        'opened_by_inspection__evidence__work_declaration__milestone',
    ).order_by('created_at'):
        current = trust_repository.get_current_status(reserve)
        status = current.source if current else None
        is_open = status in inspections.OPEN_RESERVE_STATUSES
        lifted_at = current.created_at if status == RESERVE_LIFTED else None
        milestone = _milestone_of_reserve(reserve)
        sources['reserves'].append({
            **where, 'milestone': milestone.label if milestone else '',
            'motif': reserve.motif or reserve.description or 'Réserve',
            'status': status, 'status_label': inspections.RESERVE_STATUS_LABELS.get(status, status or ''),
            'is_open': is_open, 'is_lifted': status == RESERVE_LIFTED,
            'opened_at': reserve.created_at.isoformat(),
            'opened_by': actor_label(reserve.opened_by_inspection.inspector, 'inspecteur', cache),
            'lifted_at': lifted_at.isoformat() if lifted_at else None,
            # Ancienneté depuis la date SERVEUR d'ouverture ; pour une réserve
            # levée, durée jusqu'à la levée (PO-2026-09-28-66).
            'age_days': _days_between(reserve.created_at, lifted_at or now),
        })


def _collect_movements(sources, organization_id):
    # Filtre sur l'organisation du COMPTE : la policy RLS laisse aussi le
    # bénéficiaire lire ses sorties, qui seraient sinon comptées deux fois.
    for receipt in CustomerReceipt.objects.filter(
        demo_scope('reservation__lot__asset__program__'), organization_id=organization_id,
    ).select_related(
        'reservation__lot', 'reservation__client', 'reservation__lot__asset__program',
    ).order_by('received_on', 'recorded_at'):
        reservation = receipt.reservation
        sources['entrees'].append({
            'reference': receipt.bank_reference, 'amount': f'{receipt.amount:.2f}', 'currency': receipt.currency,
            'received_on': receipt.received_on.isoformat(), 'status_label': receipt.get_status_display(),
            'reconciled': receipt.status == FlowStatus.RECONCILED_SIM,
            'program': reservation.lot.asset.program.name, 'lot': reservation.lot.name,
            'client': reservation.client.full_name,
            'dossier': {'id': str(reservation.id), 'organization_id': str(reservation.organization_id)},
        })
    executed = Disbursement.objects.filter(
        demo_scope('program__'), organization_id=organization_id, status=DisbursementStatus.EXECUTED_SIM,
    )
    sources['sorties'].append({
        'executed': executed.count(),
        'reconciled': executed.filter(flow_status=DisbursementFlowStatus.RECONCILED_SIM).count(),
        'executed_amount': executed.aggregate(total=Sum('amount'))['total'] or Decimal('0'),
        'reconciled_amount': executed.filter(
            flow_status=DisbursementFlowStatus.RECONCILED_SIM,
        ).aggregate(total=Sum('amount'))['total'] or Decimal('0'),
        'currencies': set(executed.values_list('currency', flat=True)),
    })


def collect_sources(*, caller_organization_id):
    """Sources des cinq indicateurs, toutes organisations, instance active."""
    now = timezone.now()
    sources = {key: [] for key in INDICATOR_KEYS}
    cache = {}
    try:
        for organization_id in Organization.objects.values_list('id', flat=True):
            set_rls_context(organization_id=organization_id)
            for lot in Lot.objects.filter(demo_scope('asset__program__'), organization_id=organization_id).select_related(
                'asset__program',
            ).order_by('name'):
                _collect_lot(lot, now, sources, cache)
            _collect_movements(sources, organization_id)
    finally:
        set_rls_context(organization_id=caller_organization_id)

    # A3 (PO-2026-09-28-52) : les sorties ne sortent qu'en total.
    outflows = sources.pop('sorties')
    currencies = set().union(*(item['currencies'] for item in outflows)) if outflows else set()
    sources['sorties'] = {
        'executed': sum(item['executed'] for item in outflows),
        'reconciled': sum(item['reconciled'] for item in outflows),
        'executed_amount': f"{sum((item['executed_amount'] for item in outflows), Decimal('0')):.2f}",
        'reconciled_amount': f"{sum((item['reconciled_amount'] for item in outflows), Decimal('0')):.2f}",
        'currency': currencies.pop() if len(currencies) == 1 else ('XOF' if not currencies else 'mixte'),
        'detail': 'Détail des décaissements réservé à Finance (Comptes & décaissements).',
    }
    return sources


def indicators_from(sources):
    jalons, pieces, reserves, entrees = sources['jalons'], sources['pieces'], sources['reserves'], sources['entrees']
    open_reserves = [row for row in reserves if row['is_open']]
    return {
        'jalons': {
            'label': 'Jalons examinés', 'unit': 'jalons soumis',
            'numerator': sum(1 for row in jalons if row['examined']), 'denominator': len(jalons),
            'technically_accepted': sum(1 for row in jalons if row['technically_accepted']),
        },
        'entrees': {
            'label': 'Entrées rapprochées', 'unit': 'encaissements exécutés',
            'numerator': sum(1 for row in entrees if row['reconciled']), 'denominator': len(entrees),
        },
        'sorties': {
            'label': 'Sorties rapprochées', 'unit': 'décaissements exécutés',
            'numerator': sources['sorties']['reconciled'], 'denominator': sources['sorties']['executed'],
            'executed_amount': sources['sorties']['executed_amount'], 'currency': sources['sorties']['currency'],
        },
        'reserves': {
            'label': 'Réserves', 'open': len(open_reserves), 'lifted': sum(1 for row in reserves if row['is_lifted']),
            'oldest_open_days': max((row['age_days'] for row in open_reserves), default=None),
        },
        'pieces': {
            'label': 'Pièces exigées déposées', 'unit': 'pièces exigées',
            'numerator': sum(1 for row in pieces if row['deposited']), 'denominator': len(pieces),
            'note': 'Présence d’une pièce, pas sa conformité.',
        },
    }


def indicators(*, caller_organization_id):
    sources = collect_sources(caller_organization_id=caller_organization_id)
    return {'computed_at': timezone.now().isoformat(), 'indicators': indicators_from(sources)}
