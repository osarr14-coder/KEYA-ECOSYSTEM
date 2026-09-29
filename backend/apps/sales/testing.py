"""Aide aux tests — PO-2026-09-29-09 (ordre du scénario, CDC §9.2) : le
chantier d'un lot ne s'ouvre qu'une fois son dossier concrétisé. Les tests
qui déclarent un jalon sans rejouer tout le cycle de vente (blocage,
contrat, frais, premier versement) posent ici un dossier concrétisé sur le
lot. Le cycle complet reste couvert par les tests de `apps.sales`
(T03 notamment) ; la règle elle-même par `test_ordre_scenario.py`.

Module sans test (jamais importé par le code applicatif)."""

from datetime import timedelta

from django.utils import timezone

from apps.core.rls import current_organization_id, set_rls_context


def commit_lot(lot, *, client=None):
    """Dossier concrétisé (`COMMITTED`) sur `lot`, écrit sous l'organisation
    du lot ; contexte RLS appelant restauré. Idempotent. Si le lot porte déjà
    un dossier en cours (bloqué ou réservé), c'est lui qui est concrétisé
    (un seul dossier bloquant par lot, CDC §5) ; sinon un dossier concrétisé
    est créé."""
    from apps.accounts.models import User

    from .models import Reservation, ReservationStatus

    previous = current_organization_id()
    try:
        set_rls_context(organization_id=lot.organization_id)
        existing = Reservation.objects.filter(lot_id=lot.id, status=ReservationStatus.COMMITTED).first()
        if existing is not None:
            return existing
        in_progress = Reservation.objects.filter(
            lot_id=lot.id, status__in=[ReservationStatus.HELD, ReservationStatus.RESERVED],
        ).first()
        if in_progress is not None:
            Reservation.objects.filter(id=in_progress.id).update(status=ReservationStatus.COMMITTED)
            in_progress.refresh_from_db()
            return in_progress
        if client is None:
            client, _ = User.objects.get_or_create(email=f'client-concretise-{lot.id}@test.local')
        return Reservation.objects.create(
            organization_id=lot.organization_id, lot_id=lot.id, client=client,
            status=ReservationStatus.COMMITTED, held_until=timezone.now() + timedelta(days=1),
            price_amount=lot.sale_price or 0,
        )
    finally:
        if previous:
            set_rls_context(organization_id=previous)
