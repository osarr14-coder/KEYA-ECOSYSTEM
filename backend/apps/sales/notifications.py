"""Notifications du circuit de vente — ticket B-056.

Réutilise la boîte de tâches existante (`apps.tasks`, ticket 006) : une
tâche par destinataire, créée dans l'organisation du LOT (celle du sujet),
lue via la boîte transverse `GET /api/me/tasks/inbox/`. Toujours appelées
sous le contexte RLS de l'organisation du lot.
"""
from decimal import Decimal

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import Membership
from apps.tasks.models import TaskPriority, TaskType
from apps.tasks.services import close_tasks, notify_user

ADV_ROLE_CODE = 'gestionnaire_adv'
FINANCE_ROLE_CODE = 'finance'

RESERVATION_TO_VALIDATE = 'reservation_to_validate'
PAYMENT_CALL_TO_PAY = 'payment_call_to_pay'
PAYMENT_NOTICE_TO_CONFIRM = 'payment_notice_to_confirm'
PAYMENT_RECEIVED = 'payment_received'
PAYMENT_NOTICE_REJECTED = 'payment_notice_rejected'


def users_with_role(role_code, *, restore_user_id):
    """Comptes actifs détenant ce rôle dans au moins une organisation.
    `membership_select` n'autorise que ses propres lignes (ticket 001) :
    lecture utilisateur par utilisateur, même bascule étroite que
    `apps.backoffice.services.get_user_memberships` — coût linéaire assumé
    à l'échelle du MVP. Contexte utilisateur restauré ensuite."""
    users = []
    try:
        for user in User.objects.filter(is_active=True).order_by('email'):
            set_rls_context(user_id=user.id)
            if Membership.objects.filter(user=user, role__code=role_code).exists():
                users.append(user)
    finally:
        set_rls_context(user_id=restore_user_id)
    return users


def _sales_team(*, restore_user_id):
    """Le gestionnaire (ADV). Audit UI R1 (R02) : plus de repli sur
    l'administrateur, qui n'a aucun pouvoir métier et ne pourrait pas agir
    sur la notification."""
    return users_with_role(ADV_ROLE_CODE, restore_user_id=restore_user_id)


def _xof(amount):
    return f'{int(Decimal(amount)):,}'.replace(',', ' ') + ' XOF'


def _who(user):
    return user.full_name or user.email


def _call_label(call):
    return f'{call.get_kind_display()} — {call.tier_label}' if call.tier_label else call.get_kind_display()


def _program(reservation):
    return reservation.lot.asset.program


def reservation_requested(reservation, *, actor):
    label = (
        # Audit UI R1 (J07) : le gestionnaire examine le dossier.
        f'Dossier à examiner — {_program(reservation).name} / {reservation.lot.name} — '
        f'{_who(reservation.client)}'
    )
    for member in _sales_team(restore_user_id=actor.id):
        notify_user(
            subject=reservation, organization_id=reservation.organization_id, assignee=member,
            source=RESERVATION_TO_VALIDATE, label=label, program=_program(reservation),
            priority=TaskPriority.HIGH,
        )


def reservation_validated(reservation):
    close_tasks(subject=reservation, source=RESERVATION_TO_VALIDATE)


def payment_call_issued(call):
    reservation = call.reservation
    notify_user(
        subject=call, organization_id=call.organization_id, assignee=reservation.client,
        source=PAYMENT_CALL_TO_PAY, program=_program(reservation), priority=TaskPriority.HIGH,
        label=f'Appel de fonds à régler — {_call_label(call)} : {_xof(call.amount)} — {reservation.lot.name}',
    )


def payment_declared(notice, *, actor):
    reservation = notice.reservation
    label = (
        # Audit UI R1 (PO-2026-09-27-05) : un signalement, à rapprocher du relevé.
        f'Virement signalé à traiter — {_xof(notice.amount)}, réf. client {notice.client_reference} — '
        f'{reservation.lot.name} ({_who(reservation.client)})'
    )
    for member in users_with_role(FINANCE_ROLE_CODE, restore_user_id=actor.id):
        notify_user(
            subject=notice, organization_id=notice.organization_id, assignee=member,
            source=PAYMENT_NOTICE_TO_CONFIRM, label=label, program=_program(reservation),
            priority=TaskPriority.HIGH,
        )


def payment_confirmed(notice, *, call_settled, actor):
    reservation = notice.reservation
    call = notice.payment_call
    close_tasks(subject=notice, source=PAYMENT_NOTICE_TO_CONFIRM)
    if call_settled:
        close_tasks(subject=call, source=PAYMENT_CALL_TO_PAY)
    label = (
        f'Encaissement enregistré et rapproché (simulé) — {_call_label(call)} : {_xof(notice.receipt.amount)} — {reservation.lot.name} '
        f'({_who(reservation.client)}) — réservation : {reservation.get_status_display()}'
    )
    recipients = _sales_team(restore_user_id=actor.id) + [reservation.client]
    for recipient in recipients:
        notify_user(
            subject=notice, organization_id=notice.organization_id, assignee=recipient,
            source=PAYMENT_RECEIVED, label=label, task_type=TaskType.NOTIFICATION,
            program=_program(reservation),
        )


def payment_rejected(notice):
    reservation = notice.reservation
    close_tasks(subject=notice, source=PAYMENT_NOTICE_TO_CONFIRM)
    notify_user(
        subject=notice, organization_id=notice.organization_id, assignee=reservation.client,
        source=PAYMENT_NOTICE_REJECTED, program=_program(reservation), priority=TaskPriority.HIGH,
        label=(
            f'Virement introuvable au relevé (simulé) — {_call_label(notice.payment_call)} : {notice.rejection_reason}. '
            'Vérifiez votre virement puis signalez-le à nouveau.'
        ),
    )
