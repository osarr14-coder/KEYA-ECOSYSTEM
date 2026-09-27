"""Cycle de réservation d'un lot — ticket B-048 (CDC V3 §6.1).

Toutes les écritures se font sous bascule RLS explicite vers l'organisation
du LOT, puis restauration du contexte de l'appelant dans un `finally` : le
client n'est jamais membre de cette organisation (même principe que
`apps.inspections.services.create_inspection`, ticket 005). Chaque
transition écrit son `AuditEvent` dans la même transaction.
"""

from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.audit import services as audit
from apps.core.rls import set_rls_context
from apps.inspections.services import is_milestone_technically_accepted
from apps.organizations.models import Organization
from apps.pricing.services import get_active_legal_payment_tier_template
from apps.programs.models import Lot, LotClient, LotCommercialStatus

from .models import (
    BLOCKING_STATUSES,
    DEFAULT_CURRENCY,
    IN_PROGRESS_CONTRACT_STATUSES,
    ContractStatus,
    Allocation,
    ContractVersion,
    CustomerReceipt,
    FlowStatus,
    PaymentCall,
    PaymentCallKind,
    Reservation,
    ReservationStatus,
)


# Tout ce que les serializers lisent, chargé sous le contexte RLS de
# l'organisation du lot — jamais en chargement paresseux après restauration.
_DISPLAY_RELATIONS = ('lot', 'lot__asset', 'lot__asset__program', 'organization')


class LotUnavailableError(Exception):
    """Le lot n'est pas réservable : déjà bloqué, non publié ou introuvable
    dans l'organisation indiquée. Réponse 409, jamais 500."""


class ReservationTransitionError(Exception):
    """Transition interdite depuis l'état courant (ex. annuler une
    réservation déjà expirée). Réponse 409."""


def _hold_duration():
    return timedelta(hours=settings.RESERVATION_HOLD_HOURS)


def _is_published(lot):
    return lot.commercial_status == LotCommercialStatus.DISPONIBLE and lot.sale_price is not None


def _set_lot_status(lot, status):
    if lot.commercial_status != status:
        lot.commercial_status = status
        lot.save(update_fields=['commercial_status'])


def _expire_if_overdue(reservation, now):
    """Sous contexte RLS de l'organisation du lot. Seul `held` expire : à
    partir de `reserved` (Phase 3), un encaissement existe et le CDC suspend
    toute expiration automatique au profit d'une revue Finance (§6.1)."""
    if reservation.status != ReservationStatus.HELD or reservation.held_until > now:
        return False
    # Ticket B-051 — CDC §6.1 : « après enregistrement d'un encaissement
    # bancaire simulé, l'expiration automatique est suspendue pour revue
    # Finance ; aucune libération ou restitution automatique ».
    if reservation.receipts.exists():
        return False
    reservation.status = ReservationStatus.EXPIRED
    reservation.save(update_fields=['status', 'updated_at'])
    _set_lot_status(reservation.lot, LotCommercialStatus.DISPONIBLE)
    audit.record(
        organization_id=reservation.organization_id, actor=None, action='reservation.expired',
        obj=reservation, payload={'lot_id': str(reservation.lot_id), 'held_until': reservation.held_until.isoformat()},
    )
    return True


def _expire_overdue_for_lot(lot, now):
    overdue = Reservation.objects.select_related('lot').filter(
        lot=lot, status=ReservationStatus.HELD, held_until__lte=now,
    )
    for reservation in overdue:
        _expire_if_overdue(reservation, now)


def list_published_lots(*, caller_organization_id):
    """Catalogue — lots publiés de TOUTES les organisations : `disponible`
    et prix renseigné. Boucle de bascule RLS (même mécanisme que
    `apps.procurement.services._search_lots_by_name_as_admin`, coût
    O(organisations) assumé) — jamais une policy large sur `programs_lot`
    (piège déjà corrigé, migration programs/0009). Les blocages échus sont
    libérés au passage : un lot ne reste jamais masqué par un blocage expiré.
    """
    now = timezone.now()
    results = []
    organization_ids = list(Organization.objects.values_list('id', flat=True))
    try:
        for organization_id in organization_ids:
            set_rls_context(organization_id=organization_id)
            _expire_overdue_in_current_organization(organization_id, now)
            results.extend(
                Lot.objects.filter(
                    commercial_status=LotCommercialStatus.DISPONIBLE, sale_price__isnull=False,
                ).select_related('organization', 'asset__program').order_by('asset__program__name', 'name'),
            )
    finally:
        set_rls_context(organization_id=caller_organization_id)
    return results


def request_reservation(*, client, caller_organization_id, lot_organization_id, lot_id):
    """REQUESTED puis HELD dans une seule transaction (CDC §6.1 : « blocage
    acquis atomiquement »).

    **Concurrence (T01)** : `select_for_update` sur le lot sérialise deux
    demandes simultanées — la seconde attend la fin de la première, voit
    alors le lot bloqué et reçoit `LotUnavailableError`. L'index unique
    partiel (`sales_one_blocking_reservation_per_lot`) reste le filet en
    base : si un autre chemin d'écriture ignorait ce verrou, la seconde
    insertion échouerait quand même — rattrapée dans un savepoint, jamais
    une transaction entière avortée (la requête HTTP tourne déjà dans la
    transaction du middleware RLS).
    """
    now = timezone.now()
    try:
        set_rls_context(organization_id=lot_organization_id)
        # `of=('self',)` : verrou sur la seule ligne du lot. Bien et programme
        # sont préchargés ICI, sous le contexte de l'organisation du lot : après
        # restauration du contexte client, ils seraient invisibles (RLS) au
        # moment de sérialiser la réponse.
        lot = (
            Lot.objects.select_for_update(of=('self',))
            .select_related('asset__program', 'organization')
            .filter(id=lot_id)
            .first()
        )
        if lot is None:
            raise LotUnavailableError('Lot introuvable.')
        _expire_overdue_for_lot(lot, now)
        if Reservation.objects.filter(lot=lot, status__in=BLOCKING_STATUSES).exists() or not _is_published(lot):
            raise LotUnavailableError("Ce lot n'est plus disponible à la réservation.")

        try:
            with transaction.atomic():
                reservation = Reservation.objects.create(
                    organization_id=lot.organization_id,
                    lot=lot,
                    client=client,
                    status=ReservationStatus.REQUESTED,
                    held_until=now + _hold_duration(),
                    price_amount=lot.sale_price,
                    currency=DEFAULT_CURRENCY,
                )
                audit.record(
                    organization_id=lot.organization_id, actor=client, action='reservation.requested',
                    obj=reservation, payload={'lot_id': str(lot.id)},
                )
                reservation.status = ReservationStatus.HELD
                reservation.save(update_fields=['status', 'updated_at'])
        except IntegrityError:
            raise LotUnavailableError("Ce lot n'est plus disponible à la réservation.")

        _set_lot_status(lot, LotCommercialStatus.RESERVE)
        audit.record(
            organization_id=lot.organization_id, actor=client, action='reservation.held', obj=reservation,
            payload={
                'lot_id': str(lot.id), 'held_until': reservation.held_until.isoformat(),
                'price_amount': str(reservation.price_amount), 'currency': reservation.currency,
            },
        )
        return reservation
    finally:
        set_rls_context(organization_id=caller_organization_id)


def _client_reservation_organization_ids(client, reservation_id=None):
    """Via la branche `client_id` de la policy RLS, SANS jointure : le lot
    appartient à une autre organisation, invisible sous le contexte du
    client — un `select_related('lot')` à ce stade (jointure interne) ferait
    disparaître la réservation elle-même du résultat."""
    queryset = Reservation.objects.filter(client=client)
    if reservation_id is not None:
        queryset = queryset.filter(id=reservation_id)
    return set(queryset.values_list('organization_id', flat=True))


def list_client_reservations(*, client, caller_organization_id):
    """Réservations du client, lues ensuite sous le contexte de
    l'organisation de chaque lot (jointures lot/bien/programme visibles),
    blocages échus expirés au passage."""
    now = timezone.now()
    results = []
    try:
        for organization_id in _client_reservation_organization_ids(client):
            set_rls_context(organization_id=organization_id)
            for reservation in Reservation.objects.filter(client=client, organization_id=organization_id).select_related(
                'lot', 'lot__asset', 'lot__asset__program', 'organization',
            ):
                _expire_if_overdue(reservation, now)
                results.append(reservation)
    finally:
        set_rls_context(organization_id=caller_organization_id)
    return sorted(results, key=lambda reservation: reservation.created_at, reverse=True)


def cancel_reservation_as_client(*, client, caller_organization_id, reservation_id):
    organization_ids = _client_reservation_organization_ids(client, reservation_id)
    if not organization_ids:
        return None
    try:
        set_rls_context(organization_id=organization_ids.pop())
        reservation = Reservation.objects.select_related(*_DISPLAY_RELATIONS).get(id=reservation_id, client=client)
        _cancel(reservation, actor=client, reason='')
    finally:
        set_rls_context(organization_id=caller_organization_id)
    return reservation


def list_reservations_as_admin(*, caller_organization_id, status=None):
    """Toutes les réservations, toutes organisations — admin/ADV. Même
    boucle de bascule que `apps.programs.services.list_program_requests_as_admin`."""
    now = timezone.now()
    results = []
    organization_ids = list(Organization.objects.values_list('id', flat=True))
    try:
        for organization_id in organization_ids:
            set_rls_context(organization_id=organization_id)
            queryset = Reservation.objects.filter(organization_id=organization_id).select_related(
                'lot', 'lot__asset', 'lot__asset__program', 'organization', 'client', 'cancelled_by',
            )
            for reservation in queryset:
                _expire_if_overdue(reservation, now)
                if status is None or reservation.status == status:
                    results.append(reservation)
    finally:
        set_rls_context(organization_id=caller_organization_id)
    return sorted(results, key=lambda reservation: reservation.created_at, reverse=True)


def cancel_reservation_as_admin(*, admin, caller_organization_id, target_organization_id, reservation_id, reason):
    if not reason or not reason.strip():
        raise ReservationTransitionError("Le motif d'annulation est obligatoire.")
    try:
        set_rls_context(organization_id=target_organization_id)
        reservation = Reservation.objects.filter(id=reservation_id).select_related(
            *_DISPLAY_RELATIONS, 'client', 'cancelled_by',
        ).first()
        if reservation is None:
            return None
        _cancel(reservation, actor=admin, reason=reason.strip())
    finally:
        set_rls_context(organization_id=caller_organization_id)
    return reservation


def _cancel(reservation, *, actor, reason):
    """Sous contexte RLS de l'organisation du lot. `held` seulement : au-delà,
    un encaissement existe, et désistement/remboursement sont hors MVP (CDC
    §6.1, A06)."""
    now = timezone.now()
    if _expire_if_overdue(reservation, now):
        raise ReservationTransitionError('Ce blocage a déjà expiré.')
    if reservation.status != ReservationStatus.HELD:
        raise ReservationTransitionError('Seule une réservation bloquée (sans encaissement) peut être annulée.')
    if reservation.receipts.exists():
        # Ticket B-051 — désistement et remboursement hors MVP (CDC §6.1, A06).
        raise ReservationTransitionError(
            'Un encaissement a déjà été reçu sur cette réservation : son annulation (désistement, '
            'remboursement) est hors du périmètre de la démonstration.'
        )
    reservation.status = ReservationStatus.CANCELLED
    reservation.cancelled_by = actor
    reservation.cancellation_reason = reason
    reservation.save(update_fields=['status', 'cancelled_by', 'cancellation_reason', 'updated_at'])
    _set_lot_status(reservation.lot, LotCommercialStatus.DISPONIBLE)
    audit.record(
        organization_id=reservation.organization_id, actor=actor, action='reservation.cancelled',
        obj=reservation, payload={'lot_id': str(reservation.lot_id)}, justification=reason,
    )


def has_blocking_reservation(lot):
    """Sous contexte RLS de l'organisation du lot."""
    return Reservation.objects.filter(lot=lot, status__in=BLOCKING_STATUSES).exists()


def expire_overdue_reservations():
    """Commande `expire_reservations` — balaye toutes les organisations. Hors
    requête HTTP : chaque organisation dans sa propre transaction."""
    now = timezone.now()
    expired = 0
    for organization_id in list(Organization.objects.values_list('id', flat=True)):
        with transaction.atomic():
            set_rls_context(organization_id=organization_id)
            expired += _expire_overdue_in_current_organization(organization_id, now)
    return expired


def _expire_overdue_in_current_organization(organization_id, now):
    """Filtre explicite sur `organization_id` : sous ce contexte, la
    branche `client_id` de la policy peut aussi exposer une réservation de
    l'APPELANT dans une autre organisation — sa mise à jour échouerait (0
    ligne, policy UPDATE limitée à l'organisation courante)."""
    expired = 0
    for reservation in Reservation.objects.select_related('lot').filter(
        organization_id=organization_id, status=ReservationStatus.HELD, held_until__lte=now,
    ):
        if _expire_if_overdue(reservation, now):
            expired += 1
    return expired



# ─── Contrat fictif versionné — ticket B-049 (CDC V3 §6.2) ─────────────────

# Une réservation expirée ou annulée ne reçoit plus de contrat. `committed`
# (Phase 3) reste ouvert : le CDC prévoit une correction après signature.
CONTRACTABLE_RESERVATION_STATUSES = (
    ReservationStatus.HELD, ReservationStatus.RESERVED, ReservationStatus.COMMITTED,
)

_CONTRACT_RELATIONS = ('reservation', 'reservation__lot', 'authored_by', 'approved_by')

CLIENT_VISIBLE_CONTRACT_STATUSES = (ContractStatus.APPROVED, ContractStatus.SIGNED_SIMULATED)


class ContractTransitionError(Exception):
    """Transition ou modification de contrat interdite dans l'état courant.
    Réponse 409."""


def _contractable_reservation(reservation_id):
    """Sous contexte RLS de l'organisation du lot."""
    reservation = Reservation.objects.select_related('lot').filter(id=reservation_id).first()
    if reservation is None:
        return None
    _expire_if_overdue(reservation, timezone.now())
    if reservation.status not in CONTRACTABLE_RESERVATION_STATUSES:
        raise ContractTransitionError(
            'Cette réservation est expirée ou annulée : aucun contrat ne peut plus y être préparé ou signé.'
        )
    return reservation


def list_contract_versions_as_admin(*, caller_organization_id, target_organization_id, reservation_id):
    try:
        set_rls_context(organization_id=target_organization_id)
        if not Reservation.objects.filter(id=reservation_id).exists():
            return None
        return list(
            ContractVersion.objects.filter(reservation_id=reservation_id)
            .select_related(*_CONTRACT_RELATIONS).order_by('version'),
        )
    finally:
        set_rls_context(organization_id=caller_organization_id)


def create_contract_version(*, author, caller_organization_id, target_organization_id, reservation_id, content):
    """Nouvelle version `DRAFT`, numérotée à la suite. Refusée si une version
    est déjà en cours (`DRAFT`/`REVIEW`) — l'index unique partiel en est le
    filet sous concurrence, rattrapé dans un savepoint."""
    if not content or not content.strip():
        raise ContractTransitionError('Le contenu du contrat est obligatoire.')
    try:
        set_rls_context(organization_id=target_organization_id)
        reservation = _contractable_reservation(reservation_id)
        if reservation is None:
            return None
        if ContractVersion.objects.filter(
            reservation=reservation, status__in=IN_PROGRESS_CONTRACT_STATUSES,
        ).exists():
            raise ContractTransitionError(
                'Une version est déjà en cours de rédaction ou de revue : terminez-la avant d\'en créer une autre.'
            )
        latest = ContractVersion.objects.filter(reservation=reservation).order_by('-version').first()
        try:
            with transaction.atomic():
                contract = ContractVersion.objects.create(
                    organization_id=reservation.organization_id,
                    reservation=reservation,
                    client_id=reservation.client_id,
                    version=(latest.version + 1) if latest else 1,
                    status=ContractStatus.DRAFT,
                    content=content.strip(),
                    authored_by=author,
                )
        except IntegrityError:
            raise ContractTransitionError('Une autre version vient d\'être créée pour cette réservation.')
        audit.record(
            organization_id=reservation.organization_id, actor=author, action='contract.created', obj=contract,
            payload={'reservation_id': str(reservation.id), 'version': contract.version},
        )
        return ContractVersion.objects.select_related(*_CONTRACT_RELATIONS).get(id=contract.id)
    finally:
        set_rls_context(organization_id=caller_organization_id)


def _admin_contract(contract_id):
    """Sous contexte RLS de l'organisation cible."""
    return ContractVersion.objects.select_related(*_CONTRACT_RELATIONS).filter(id=contract_id).first()


def update_contract_content(*, author, caller_organization_id, target_organization_id, contract_id, content):
    if not content or not content.strip():
        raise ContractTransitionError('Le contenu du contrat est obligatoire.')
    try:
        set_rls_context(organization_id=target_organization_id)
        contract = _admin_contract(contract_id)
        if contract is None:
            return None
        if contract.status != ContractStatus.DRAFT:
            raise ContractTransitionError(
                'Seul un brouillon se modifie. Une version soumise, approuvée ou signée est figée : '
                'créez une nouvelle version.'
            )
        _contractable_reservation(contract.reservation_id)
        contract.content = content.strip()
        contract.save(update_fields=['content', 'updated_at'])
        audit.record(
            organization_id=contract.organization_id, actor=author, action='contract.edited', obj=contract,
            payload={'version': contract.version},
        )
        return contract
    finally:
        set_rls_context(organization_id=caller_organization_id)


# action → (état de départ requis, état d'arrivée, action d'audit)
_ADMIN_TRANSITIONS = {
    'submit': (ContractStatus.DRAFT, ContractStatus.REVIEW, 'contract.submitted'),
    'back_to_draft': (ContractStatus.REVIEW, ContractStatus.DRAFT, 'contract.returned_to_draft'),
    'approve': (ContractStatus.REVIEW, ContractStatus.APPROVED, 'contract.approved'),
}


def transition_contract(*, actor, caller_organization_id, target_organization_id, contract_id, action):
    if action not in _ADMIN_TRANSITIONS:
        raise ContractTransitionError('Action inconnue.')
    required, target, audit_action = _ADMIN_TRANSITIONS[action]
    try:
        set_rls_context(organization_id=target_organization_id)
        contract = _admin_contract(contract_id)
        if contract is None:
            return None
        if contract.status != required:
            raise ContractTransitionError(
                f'Transition impossible depuis l\'état « {contract.get_status_display()} ».'
            )
        _contractable_reservation(contract.reservation_id)
        now = timezone.now()
        contract.status = target
        update_fields = ['status', 'updated_at']
        if action == 'submit':
            contract.submitted_at = now
            update_fields.append('submitted_at')
        elif action == 'approve':
            contract.approved_by = actor
            contract.approved_at = now
            update_fields += ['approved_by', 'approved_at']
        contract.save(update_fields=update_fields)
        audit.record(
            organization_id=contract.organization_id, actor=actor, action=audit_action, obj=contract,
            payload={'version': contract.version, 'from': required, 'to': target},
        )
        return contract
    finally:
        set_rls_context(organization_id=caller_organization_id)


def _client_contract_organization_id(client, **filters):
    """Via la branche `client_id` de la policy RLS, sans jointure (même
    piège que `_client_reservation_organization_ids`)."""
    return ContractVersion.objects.filter(client=client, **filters).values_list('organization_id', flat=True).first()


def list_client_contract_versions(*, client, caller_organization_id, reservation_id):
    organization_id = (
        _client_contract_organization_id(client, reservation_id=reservation_id)
        or next(iter(_client_reservation_organization_ids(client, reservation_id)), None)
    )
    if organization_id is None:
        return None
    try:
        set_rls_context(organization_id=organization_id)
        # Brouillons et versions en revue sont un travail interne du
        # gestionnaire : le client ne voit que ce qu'il peut signer ou a signé.
        return list(
            ContractVersion.objects.filter(
                reservation_id=reservation_id, client=client,
                status__in=CLIENT_VISIBLE_CONTRACT_STATUSES,
            ).select_related(*_CONTRACT_RELATIONS).order_by('version'),
        )
    finally:
        set_rls_context(organization_id=caller_organization_id)


def sign_contract_as_client(*, client, caller_organization_id, contract_id):
    """Signature SIMULÉE (CDC §6.2) par le client de la réservation, lui seul.
    Seule la dernière version, approuvée, est signable ; le contenu approuvé
    n'est pas touché (le trigger le garantit aussi)."""
    organization_id = _client_contract_organization_id(client, id=contract_id)
    if organization_id is None:
        return None
    try:
        set_rls_context(organization_id=organization_id)
        contract = ContractVersion.objects.select_related(*_CONTRACT_RELATIONS).get(id=contract_id, client=client)
        if contract.status != ContractStatus.APPROVED:
            raise ContractTransitionError('Seule une version approuvée par le gestionnaire peut être signée.')
        latest_version = ContractVersion.objects.filter(
            reservation_id=contract.reservation_id,
        ).order_by('-version').values_list('version', flat=True).first()
        if contract.version != latest_version:
            raise ContractTransitionError(
                'Une version plus récente de ce contrat existe : seule la dernière version peut être signée.'
            )
        _contractable_reservation(contract.reservation_id)
        contract.status = ContractStatus.SIGNED_SIMULATED
        contract.signed_at = timezone.now()
        contract.save(update_fields=['status', 'signed_at', 'updated_at'])
        audit.record(
            organization_id=contract.organization_id, actor=client, action='contract.signed_simulated',
            obj=contract, payload={'version': contract.version, 'simulation': True},
        )
        # Ticket B-051 — la signature peut être la dernière condition de la
        # concrétisation (premier versement déjà couvert).
        evaluate_reservation_transitions(
            Reservation.objects.select_for_update(of=('self',)).select_related('lot').get(id=contract.reservation_id),
            actor=client,
        )
        return contract
    finally:
        set_rls_context(organization_id=caller_organization_id)


# ─── Appels de fonds — ticket B-050 (CDC V3 §5/§8.1/§9.1) ─────────────────

_WHOLE_UNITS = Decimal('1')  # XOF : montants entiers (CDC §5).


class PaymentCallError(Exception):
    """Appel non émissible dans l'état courant — le message dit pourquoi.
    Réponse 409."""


def _amount(value):
    return Decimal(value).quantize(_WHOLE_UNITS, rounding=ROUND_HALF_UP)


def _tier_steps(reservation):
    template = get_active_legal_payment_tier_template(reservation.organization.country_pack_id)
    if template is None:
        return None, []
    return template, list(template.steps.order_by('order'))


def compute_payment_call_candidates(reservation):
    """Le PROCHAIN appel de chaque nature, avec son montant et, s'il n'est
    pas émissible, la raison. Sous contexte RLS de l'organisation du lot.

    - frais : `RESERVATION_FEE_AMOUNT`, réservation `held` ;
    - complément du premier versement : plafond du premier palier × prix −
      frais (jamais déduits deux fois, CDC §9.1), réservation `reserved` ;
    - versement : seul le palier SUIVANT dans l'ordre, pour plafond cumulé ×
      prix − total déjà appelé, réservation `committed` ET jalon de même code
      techniquement accepté (garantie VEFA : aucun appel au-delà de
      l'avancement réel du chantier).
    """
    calls = list(reservation.payment_calls.all())
    called_kinds = {call.kind for call in calls}
    called_tiers = {call.tier_code for call in calls if call.kind == PaymentCallKind.VERSEMENT}
    called_total = sum((call.amount for call in calls), Decimal('0'))
    price = reservation.price_amount
    fee = _amount(settings.RESERVATION_FEE_AMOUNT)
    template, steps = _tier_steps(reservation)
    candidates = []

    if PaymentCallKind.FRAIS not in called_kinds:
        candidates.append({
            'kind': PaymentCallKind.FRAIS, 'tier_code': '', 'tier_label': '', 'cumulative_cap_percent': None,
            'amount': fee,
            'reason': None if reservation.status == ReservationStatus.HELD
            else 'Les frais ne s\'appellent que sur une réservation bloquée.',
        })

    if template is None:
        return template, candidates, 'Aucun barème légal de paiement actif pour ce Country Pack.'

    first, following = steps[0], steps[1:]
    if PaymentCallKind.PREMIER_VERSEMENT not in called_kinds:
        candidates.append({
            'kind': PaymentCallKind.PREMIER_VERSEMENT, 'tier_code': first.code, 'tier_label': first.label,
            'cumulative_cap_percent': first.cumulative_cap_percent,
            'amount': _amount(price * first.cumulative_cap_percent / 100) - fee,
            'reason': None if reservation.status == ReservationStatus.RESERVED
            else 'Le complément du premier versement s\'appelle une fois les frais encaissés (réservation « Réservée »).',
        })
        return template, candidates, None

    next_step = next((step for step in following if step.code not in called_tiers), None)
    if next_step is not None:
        amount = _amount(price * next_step.cumulative_cap_percent / 100) - called_total
        if next_step.order == steps[-1].order:
            amount = price - called_total  # dernier palier : solde exact, aucun reliquat d'arrondi
        milestone = reservation.lot.milestones.filter(code=next_step.code).first()
        if reservation.status != ReservationStatus.COMMITTED:
            reason = 'Les versements de palier ne s\'appellent qu\'après concrétisation de la réservation.'
        elif milestone is None:
            reason = f'Aucun jalon « {next_step.code} » sur ce lot : ce palier ne peut pas être débloqué.'
        elif not is_milestone_technically_accepted(milestone):
            reason = f'Le jalon « {milestone.label} » n\'est pas encore techniquement accepté.'
        else:
            reason = None
        candidates.append({
            'kind': PaymentCallKind.VERSEMENT, 'tier_code': next_step.code, 'tier_label': next_step.label,
            'cumulative_cap_percent': next_step.cumulative_cap_percent, 'amount': amount, 'reason': reason,
        })
    return template, candidates, None


def _team_reservation(reservation_id, *, lock=False):
    queryset = Reservation.objects.select_related('lot', 'organization', 'client')
    if lock:
        queryset = queryset.select_for_update(of=('self',))
    reservation = queryset.filter(id=reservation_id).first()
    if reservation is not None:
        _expire_if_overdue(reservation, timezone.now())
    return reservation


def list_payment_calls_as_team(*, caller_organization_id, target_organization_id, reservation_id):
    try:
        set_rls_context(organization_id=target_organization_id)
        reservation = _team_reservation(reservation_id)
        if reservation is None:
            return None
        _template, candidates, blocking_reason = compute_payment_call_candidates(reservation)
        calls = _with_settlement(reservation.payment_calls.select_related('issued_by').order_by('issued_at'))
        return {'calls': calls, 'candidates': candidates, 'blocking_reason': blocking_reason}
    finally:
        set_rls_context(organization_id=caller_organization_id)


def issue_payment_call(*, actor, caller_organization_id, target_organization_id, reservation_id, kind, tier_code=''):
    """Émet l'appel candidat correspondant. Verrou de ligne sur la
    réservation : deux émissions simultanées sont sérialisées ; l'index
    unique reste le filet en base."""
    try:
        set_rls_context(organization_id=target_organization_id)
        reservation = _team_reservation(reservation_id, lock=True)
        if reservation is None:
            return None
        template, candidates, blocking_reason = compute_payment_call_candidates(reservation)
        candidate = next(
            (c for c in candidates if c['kind'] == kind and (kind != PaymentCallKind.VERSEMENT or c['tier_code'] == tier_code)),
            None,
        )
        if candidate is None:
            raise PaymentCallError(blocking_reason or 'Cet appel a déjà été émis ou n\'est pas le prochain à émettre.')
        if candidate['reason']:
            raise PaymentCallError(candidate['reason'])
        try:
            with transaction.atomic():
                call = PaymentCall.objects.create(
                    organization_id=reservation.organization_id,
                    reservation=reservation,
                    client_id=reservation.client_id,
                    kind=kind,
                    legal_template=template if kind != PaymentCallKind.FRAIS else None,
                    tier_code=candidate['tier_code'],
                    tier_label=candidate['tier_label'],
                    cumulative_cap_percent=candidate['cumulative_cap_percent'],
                    amount=candidate['amount'],
                    currency=reservation.currency,
                    issued_by=actor,
                )
        except IntegrityError:
            raise PaymentCallError('Cet appel vient déjà d\'être émis.')
        audit.record(
            organization_id=reservation.organization_id, actor=actor, action='payment_call.issued', obj=call,
            payload={
                'reservation_id': str(reservation.id), 'kind': kind, 'tier_code': call.tier_code,
                'amount': str(call.amount), 'currency': call.currency,
                'legal_template_id': str(template.id) if call.legal_template_id else None,
            },
        )
        return call
    finally:
        set_rls_context(organization_id=caller_organization_id)


def list_client_payment_calls(*, client, caller_organization_id, reservation_id):
    organization_ids = _client_reservation_organization_ids(client, reservation_id)
    if not organization_ids:
        return None
    try:
        set_rls_context(organization_id=organization_ids.pop())
        return _with_settlement(
            PaymentCall.objects.filter(reservation_id=reservation_id, client=client).order_by('issued_at'),
        )
    finally:
        set_rls_context(organization_id=caller_organization_id)


# ─── Encaissements, affectations, transitions — ticket B-051 (CDC V3 §6.1/§8) ──


class ReceiptError(Exception):
    """Opération d'encaissement impossible dans l'état courant — le message
    dit pourquoi. Réponse 409."""


def _sum(queryset):
    return queryset.aggregate(total=Sum('amount'))['total'] or Decimal('0')


def allocated_amount(payment_call):
    return _sum(payment_call.allocations.all())


def settled_amount(payment_call):
    """Seules les affectations d'encaissements RAPPROCHÉS comptent (CDC §6.1 :
    « encaissement simulé rapproché et affecté »)."""
    return _sum(payment_call.allocations.filter(receipt__status=FlowStatus.RECONCILED_SIM))


def unallocated_amount(receipt):
    return receipt.amount - _sum(receipt.allocations.all())


def _is_settled(reservation, kind):
    call = reservation.payment_calls.filter(kind=kind).first()
    return call is not None and settled_amount(call) >= call.amount


def evaluate_reservation_transitions(reservation, *, actor):
    """Transitions AUTOMATIQUES du CDC §6.1, réévaluées après chaque
    affectation, rapprochement ou signature — jamais un bouton :
    - HELD → RESERVED : frais appelés, entièrement couverts par des
      encaissements rapprochés (« le paiement des seuls frais ne concrétise
      pas le dossier ») ;
    - RESERVED → COMMITTED : dernière version du contrat signée ET frais +
      complément du premier versement couverts (T03 : total 3 000 000, sans
      double imputation). À la concrétisation : lot « vendu », `LotClient`.
    Sous contexte RLS de l'organisation du lot."""
    if reservation.status == ReservationStatus.HELD and _is_settled(reservation, PaymentCallKind.FRAIS):
        reservation.status = ReservationStatus.RESERVED
        reservation.save(update_fields=['status', 'updated_at'])
        audit.record(
            organization_id=reservation.organization_id, actor=actor, action='reservation.reserved', obj=reservation,
            payload={'reason': 'frais encaissés, rapprochés et affectés'},
        )

    if reservation.status == ReservationStatus.RESERVED:
        latest_contract = reservation.contract_versions.order_by('-version').first()
        signed = latest_contract is not None and latest_contract.status == ContractStatus.SIGNED_SIMULATED
        if signed and _is_settled(reservation, PaymentCallKind.FRAIS) and _is_settled(
            reservation, PaymentCallKind.PREMIER_VERSEMENT,
        ):
            reservation.status = ReservationStatus.COMMITTED
            reservation.save(update_fields=['status', 'updated_at'])
            _set_lot_status(reservation.lot, LotCommercialStatus.VENDU)
            LotClient.objects.get_or_create(
                lot=reservation.lot, client_id=reservation.client_id,
                defaults={'organization_id': reservation.organization_id},
            )
            audit.record(
                organization_id=reservation.organization_id, actor=actor, action='reservation.committed',
                obj=reservation,
                payload={'contract_version': latest_contract.version, 'reason': 'contrat signé et premier versement couvert'},
            )


def _finance_reservation(reservation_id):
    return (
        Reservation.objects.select_for_update(of=('self',))
        .select_related('lot', 'organization', 'client')
        .filter(id=reservation_id)
        .first()
    )


def record_receipt(*, finance, caller_organization_id, target_organization_id, reservation_id,
                   bank_reference, amount, received_on):
    """Encaissement simulé (état « reçu en banque »). IDEMPOTENT (CDC §8.3,
    T10) : la même référence bancaire rejouée à l'identique renvoie le
    mouvement existant (`created=False`), jamais un second ; rejouée avec
    d'autres données, elle est refusée — jamais une modification silencieuse."""
    reference = (bank_reference or '').strip()
    if not reference:
        raise ReceiptError('La référence bancaire simulée est obligatoire.')
    if amount is None or amount <= 0:
        raise ReceiptError('Le montant doit être strictement positif.')
    try:
        set_rls_context(organization_id=target_organization_id)
        reservation = _finance_reservation(reservation_id)
        if reservation is None:
            return None, False

        def existing_or_conflict():
            existing = CustomerReceipt.objects.filter(
                organization_id=reservation.organization_id, bank_reference=reference,
            ).first()
            if existing is None:
                return None
            if (existing.reservation_id, existing.amount, existing.received_on) != (reservation.id, amount, received_on):
                raise ReceiptError(
                    f'La référence « {reference} » désigne déjà un autre mouvement : '
                    'un mouvement enregistré ne se modifie jamais.'
                )
            return existing

        existing = existing_or_conflict()
        if existing is not None:
            return existing, False

        _expire_if_overdue(reservation, timezone.now())
        if reservation.status not in (ReservationStatus.HELD, ReservationStatus.RESERVED, ReservationStatus.COMMITTED):
            raise ReceiptError('Cette réservation est expirée ou annulée : aucun encaissement ne peut y être rattaché.')
        try:
            with transaction.atomic():
                receipt = CustomerReceipt.objects.create(
                    organization_id=reservation.organization_id, reservation=reservation,
                    client_id=reservation.client_id, bank_reference=reference, amount=amount,
                    currency=reservation.currency, received_on=received_on, recorded_by=finance,
                )
        except IntegrityError:
            existing = existing_or_conflict()
            return existing, False
        audit.record(
            organization_id=reservation.organization_id, actor=finance, action='receipt.recorded', obj=receipt,
            payload={
                'reservation_id': str(reservation.id), 'bank_reference': reference, 'amount': str(amount),
                'currency': receipt.currency, 'simulation': True,
            },
        )
        return receipt, True
    finally:
        set_rls_context(organization_id=caller_organization_id)


def allocate_receipt(*, finance, caller_organization_id, target_organization_id, receipt_id, payment_call_id, amount):
    """Affecte une partie d'un encaissement à un appel du MÊME dossier.

    Verrou de ligne sur la RÉSERVATION : toutes les affectations d'un
    dossier sont sérialisées, donc jamais deux fois le même montant d'un
    encaissement, ni au-delà du montant d'un appel, même depuis deux
    encaissements différents (T10/T12). Pas de verrou sur l'appel lui-même :
    `SELECT … FOR UPDATE` exige aussi une policy RLS UPDATE, que la table
    append-only des appels n'a volontairement pas (la ligne serait alors
    invisible — constaté en écrivant les tests de ce ticket)."""
    if amount is None or amount <= 0:
        raise ReceiptError('Le montant affecté doit être strictement positif.')
    try:
        set_rls_context(organization_id=target_organization_id)
        reservation_id = CustomerReceipt.objects.filter(id=receipt_id).values_list('reservation_id', flat=True).first()
        if reservation_id is None:
            return None
        reservation = _finance_reservation(reservation_id)
        receipt = CustomerReceipt.objects.get(id=receipt_id)
        call = PaymentCall.objects.filter(id=payment_call_id).first()
        if call is None or call.reservation_id != receipt.reservation_id:
            raise ReceiptError('Cet appel n\'appartient pas au dossier de cet encaissement.')
        if amount > unallocated_amount(receipt):
            raise ReceiptError(
                f'Montant supérieur au solde non affecté de l\'encaissement ({unallocated_amount(receipt)} {receipt.currency}).'
            )
        remaining_on_call = call.amount - allocated_amount(call)
        if amount > remaining_on_call:
            raise ReceiptError(
                f'Montant supérieur au reste à couvrir sur cet appel ({remaining_on_call} {call.currency}) : '
                'aucune double imputation.'
            )
        allocation = Allocation.objects.create(
            organization_id=receipt.organization_id, receipt=receipt, payment_call=call,
            client_id=receipt.client_id, amount=amount, allocated_by=finance,
        )
        audit.record(
            organization_id=receipt.organization_id, actor=finance, action='receipt.allocated', obj=allocation,
            payload={'receipt_id': str(receipt.id), 'payment_call_id': str(call.id), 'amount': str(amount)},
        )
        evaluate_reservation_transitions(reservation, actor=finance)
        return allocation
    finally:
        set_rls_context(organization_id=caller_organization_id)


def reconcile_receipt(*, finance, caller_organization_id, target_organization_id, receipt_id):
    """Rapprochement (CDC §8.1) : vérifie montant, devise, client, référence
    et affectations ; une anomalie le bloque. Déclenche les transitions."""
    try:
        set_rls_context(organization_id=target_organization_id)
        receipt = CustomerReceipt.objects.select_for_update().select_related('reservation').filter(id=receipt_id).first()
        if receipt is None:
            return None
        if receipt.status != FlowStatus.BANK_EXECUTED_SIM:
            raise ReceiptError('Cet encaissement est déjà rapproché.')
        reservation = receipt.reservation
        anomalies = []
        if receipt.currency != reservation.currency:
            anomalies.append('devise différente de celle du dossier')
        if receipt.client_id != reservation.client_id:
            anomalies.append('client différent de celui du dossier')
        if unallocated_amount(receipt) < 0:
            anomalies.append('affectations supérieures au montant reçu')
        if anomalies:
            raise ReceiptError('Rapprochement bloqué : ' + ', '.join(anomalies) + '.')
        receipt.status = FlowStatus.RECONCILED_SIM
        receipt.reconciled_by = finance
        receipt.reconciled_at = timezone.now()
        receipt.save(update_fields=['status', 'reconciled_by', 'reconciled_at'])
        audit.record(
            organization_id=receipt.organization_id, actor=finance, action='receipt.reconciled', obj=receipt,
            payload={'unallocated': str(unallocated_amount(receipt)), 'simulation': True},
        )
        evaluate_reservation_transitions(_finance_reservation(reservation.id), actor=finance)
        return receipt
    finally:
        set_rls_context(organization_id=caller_organization_id)


def get_finance_file(*, caller_organization_id, target_organization_id, reservation_id):
    """Dossier financier d'une réservation (équipe KEYIMMO) : appels avec
    montants affectés/couverts, encaissements avec leur solde non affecté."""
    try:
        set_rls_context(organization_id=target_organization_id)
        reservation = Reservation.objects.select_related('lot', 'organization', 'client').filter(id=reservation_id).first()
        if reservation is None:
            return None
        calls = _with_settlement(reservation.payment_calls.select_related('issued_by').order_by('issued_at'))
        receipts = list(
            reservation.receipts.select_related('recorded_by', 'reconciled_by').prefetch_related('allocations')
            .order_by('recorded_at'),
        )
        for receipt in receipts:
            receipt.unallocated_total = unallocated_amount(receipt)
        return {'reservation': reservation, 'calls': calls, 'receipts': receipts}
    finally:
        set_rls_context(organization_id=caller_organization_id)


def _with_settlement(calls):
    """Montants affectés / couverts de chaque appel, calculés sous le
    contexte RLS courant (celui du lot) — jamais recalculés par le
    serializer, qui tourne après restauration du contexte de l'appelant."""
    calls = list(calls)
    for call in calls:
        call.allocated_total = allocated_amount(call)
        call.settled_total = settled_amount(call)
    return calls
