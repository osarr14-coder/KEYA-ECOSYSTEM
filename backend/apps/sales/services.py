"""Cycle de réservation d'un lot — ticket B-048 (CDC V3 §6.1).

Toutes les écritures se font sous bascule RLS explicite vers l'organisation
du LOT, puis restauration du contexte de l'appelant dans un `finally` : le
client n'est jamais membre de cette organisation (même principe que
`apps.inspections.services.create_inspection`, ticket 005). Chaque
transition écrit son `AuditEvent` dans la même transaction.
"""

from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit import services as audit
from apps.core.rls import set_rls_context
from apps.organizations.models import Organization
from apps.programs.models import Lot, LotCommercialStatus

from .models import BLOCKING_STATUSES, DEFAULT_CURRENCY, Reservation, ReservationStatus


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

