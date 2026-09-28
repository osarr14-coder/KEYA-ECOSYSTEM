"""Relais entre rôles — lot 2 (PO-2026-09-28-44, frictions P08 à P11, P33).

Chaque transition crée une entrée « À faire » pour le rôle qui doit agir
ensuite, et met à jour la cloche (qui compte les tâches en attente) ;
l'entrée disparaît quand l'action est faite.

Les états des jalons sont CALCULÉS (doctrine Visible Trust), jamais
stockés : plutôt que d'accrocher chaque transition une à une,
`sync_lot_relays` recalcule, pour un lot, les tâches qui doivent exister
et ferme celles qui n'ont plus lieu d'être. Idempotente, elle est appelée
après chaque action qui peut changer l'état d'un jalon ou d'un dossier, dans
la même transaction (CDC §10). Toujours sous le contexte RLS de
l'organisation du lot.
"""
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone

from apps.core.rls import set_rls_context
from apps.organizations.models import Membership

from . import services
from .models import Task, TaskPriority, TaskStatus, TaskType

GESTIONNAIRE_ROLE_CODE = 'gestionnaire_adv'
FINANCE_ROLE_CODE = 'finance'
CONSTRUCTEUR_ROLE_CODE = 'constructeur'

COMPLEMENT_TO_CALL = 'complement_to_call'
CONTROL_TO_ASSIGN = 'control_to_assign'
MILESTONE_DISBURSABLE = 'milestone_disbursable'
MILESTONE_TO_DECLARE = 'milestone_to_declare'
DISBURSEMENT_TO_CONFIRM = 'disbursement_to_confirm'
RESERVATION_ENDED = 'reservation_ended'


def ensure_task(*, subject, organization_id, assignees, source, label, program=None,
                priority=TaskPriority.NORMAL, task_type=TaskType.TASK):
    """Une entrée en attente par destinataire. Une entrée déjà traitée pour
    le même sujet (cycle précédent : recontrôle, nouvelle revue) est
    remise en attente, datée de maintenant, plutôt que dupliquée."""
    for assignee in assignees:
        task = services.notify_user(
            subject=subject, organization_id=organization_id, assignee=assignee, source=source,
            label=label, task_type=task_type, program=program, priority=priority,
        )
        if task.status == TaskStatus.DONE:
            Task.objects.filter(id=task.id).update(
                status=TaskStatus.PENDING, completed_at=None, label=label[:255], created_at=timezone.now(),
            )
        elif task.label != label[:255]:
            Task.objects.filter(id=task.id).update(label=label[:255])


def close(subject, source):
    return services.close_tasks(subject=subject, source=source)


def in_organization(organization_id, *, restore_organization_id, action):
    """Exécute `action` sous le contexte RLS d'une autre organisation (celle
    du constructeur affecté au lot, `Lot.assigned_organization`, qui lit ses
    tâches dans SA propre organisation), puis restaure l'organisation du
    lot. Aucune bascule quand les deux coïncident (jeu de démonstration)."""
    if str(organization_id) == str(restore_organization_id):
        return action()
    try:
        set_rls_context(organization_id=organization_id)
        return action()
    finally:
        set_rls_context(organization_id=restore_organization_id)


def constructeur_organization_id(lot):
    """Même règle que le bénéficiaire d'un décaissement
    (`apps.sales.services`) : le prestataire affecté, à défaut
    l'organisation du lot."""
    return lot.assigned_organization_id or lot.organization_id


def _close_exact(subject, source):
    """Tâches historiques sans destinataire suffixé (réserve ouverte,
    mission affectée : tickets 006 et 012)."""
    return Task.objects.filter(
        subject_type=ContentType.objects.get_for_model(subject), subject_id=subject.pk,
        source=source, status=TaskStatus.PENDING,
    ).update(status=TaskStatus.DONE, completed_at=timezone.now())


def members_with_role(role_code, *, organization_id, restore_user_id):
    """Comptes actifs détenant ce rôle DANS cette organisation. Même bascule
    étroite que `apps.sales.notifications.users_with_role` (la policy
    `membership_select` n'autorise que ses propres lignes) ; le contexte
    d'organisation n'est pas touché."""
    from apps.sales.notifications import users_with_role

    members = []
    try:
        for user in users_with_role(role_code, restore_user_id=restore_user_id):
            set_rls_context(user_id=user.id)
            if Membership.objects.filter(user=user, organization_id=organization_id, role__code=role_code).exists():
                members.append(user)
    finally:
        set_rls_context(user_id=restore_user_id)
    return members


class _Recipients:
    """Destinataires lus une seule fois par synchronisation."""

    def __init__(self, lot, actor):
        self.lot = lot
        self.actor = actor
        self._cache = {}

    def _get(self, key, loader):
        if key not in self._cache:
            self._cache[key] = loader()
        return self._cache[key]

    def gestionnaires(self):
        from apps.sales.notifications import users_with_role

        return self._get('g', lambda: users_with_role(GESTIONNAIRE_ROLE_CODE, restore_user_id=self.actor.id))

    def finance(self):
        from apps.sales.notifications import users_with_role

        return self._get('f', lambda: users_with_role(FINANCE_ROLE_CODE, restore_user_id=self.actor.id))

    def constructeurs(self, organization_id=None):
        organization_id = organization_id or self.lot.organization_id
        return self._get(('c', organization_id), lambda: members_with_role(
            CONSTRUCTEUR_ROLE_CODE, organization_id=organization_id, restore_user_id=self.actor.id,
        ))


def sync_lot_relays(lot, *, actor):
    """Recalcule les relais du chantier d'un lot (R2, R3, R4, R6, R7)."""
    from apps.inspections import services as inspections
    from apps.inspections.models import InspectionMission, Reserve, ReserveCorrection
    from apps.sales.models import DisbursementStatus, Reservation, ReservationStatus
    from apps.tasks.services import MISSION_ASSIGNED_SOURCE, RESERVE_OPENED_SOURCE

    recipients = _Recipients(lot, actor)
    program = lot.asset.program
    committed = Reservation.objects.filter(lot=lot, status=ReservationStatus.COMMITTED).exists()
    next_to_declare = None
    earlier_not_accepted = False
    for milestone in lot.milestones.order_by('order'):
        state = inspections.milestone_control_state(milestone)
        status = state['status']

        # R2 — affectation du contrôle : jalon soumis, resoumis après
        # correction ou « Nouvelle revue nécessaire », sans mission en cours.
        recontrol = status == inspections.UNDER_RESERVE and state['correction_submitted']
        if state['pending_mission'] is None and (status == inspections.AWAITING_CONTROL or recontrol):
            if recontrol:
                reason = 'recontrôle après correction du constructeur'
            elif state['stale_acceptance']:
                reason = 'nouvelle revue nécessaire : pièce ajoutée après l’acceptation'
            else:
                reason = 'jalon soumis par le constructeur'
            ensure_task(
                subject=milestone, organization_id=lot.organization_id, assignees=recipients.gestionnaires(),
                source=CONTROL_TO_ASSIGN, label=services._control_to_assign_label(milestone, reason),
                program=program, priority=TaskPriority.HIGH,
            )
        else:
            close(milestone, CONTROL_TO_ASSIGN)

        # R3 — jalon décaissable : accepté techniquement, pas encore décaissé.
        disbursed = milestone.disbursements.filter(status=DisbursementStatus.EXECUTED_SIM).exists()
        if status == inspections.ACCEPTED and not disbursed:
            ensure_task(
                subject=milestone, organization_id=lot.organization_id, assignees=recipients.finance(),
                source=MILESTONE_DISBURSABLE, label=services._milestone_disbursable_label(milestone),
                program=program,
            )
        else:
            close(milestone, MILESTONE_DISBURSABLE)

        # R4 : le jalon suivant n'est à déclarer qu'une fois les précédents
        # acceptés techniquement (un seul à la fois, P21).
        if next_to_declare is None and not earlier_not_accepted:
            if status in (inspections.NOT_DECLARED, inspections.AWAITING_DOCUMENTS):
                next_to_declare = milestone
            elif status != inspections.ACCEPTED:
                earlier_not_accepted = True

    # R4 — dossier concrétisé : le constructeur déclare le premier jalon non
    # encore soumis dont les précédents sont acceptés.
    builder_organization_id = constructeur_organization_id(lot)
    builders = recipients.constructeurs(builder_organization_id)

    def declare_relays():
        for milestone in lot.milestones.all():
            if committed and next_to_declare is not None and milestone.id == next_to_declare.id:
                ensure_task(
                    subject=milestone, organization_id=builder_organization_id, assignees=builders,
                    source=MILESTONE_TO_DECLARE, label=services._milestone_to_declare_label(milestone),
                    program=program,
                )
            else:
                close(milestone, MILESTONE_TO_DECLARE)

    in_organization(builder_organization_id, restore_organization_id=lot.organization_id, action=declare_relays)

    # R6 — réserve : la tâche du constructeur se ferme dès sa correction
    # proposée, ou quand la réserve n'est plus ouverte.
    for reserve in Reserve.objects.filter(lot=lot):
        if not inspections.is_reserve_open(reserve) or ReserveCorrection.objects.filter(reserve=reserve).exists():
            _close_exact(reserve, RESERVE_OPENED_SOURCE)

    # R7 — mission : la tâche du contrôleur se ferme dès son avis rendu.
    for mission in InspectionMission.objects.filter(work_declaration__milestone__lot=lot).select_related('work_declaration'):
        pending = inspections.pending_mission_for(mission.work_declaration)
        if pending is None or pending.id != mission.id:
            _close_exact(mission, MISSION_ASSIGNED_SOURCE)


def complement_to_call(reservation, *, actor):
    """R1 — réservation « Réservée » (frais rapprochés) : le gestionnaire
    appelle le complément du premier versement."""
    from apps.organizations.identity import SEPARATOR, actor_parts

    _org, role = actor_parts(reservation.client, 'client')
    client_label = SEPARATOR.join(((reservation.client.full_name or 'Client'), (role or 'Client')))
    ensure_task(
        subject=reservation, organization_id=reservation.organization_id,
        assignees=_Recipients(reservation.lot, actor).gestionnaires(), source=COMPLEMENT_TO_CALL,
        label=services._complement_to_call_label(reservation, client_label),
        program=reservation.lot.asset.program, priority=TaskPriority.HIGH,
    )


def disbursement_executed(disbursement, *, actor):
    """R5 — décaissement exécuté : le constructeur bénéficiaire peut
    confirmer la réception (facultatif)."""
    builders = _Recipients(disbursement.lot, actor).constructeurs(disbursement.beneficiary_organization_id)
    in_organization(
        disbursement.beneficiary_organization_id, restore_organization_id=disbursement.organization_id,
        action=lambda: ensure_task(
            subject=disbursement, organization_id=disbursement.beneficiary_organization_id, assignees=builders,
            source=DISBURSEMENT_TO_CONFIRM, label=services._disbursement_to_confirm_label(disbursement),
            program=disbursement.program,
        ),
    )


def disbursement_settled(disbursement):
    """R5 — confirmation reçue ou rapprochement fait : plus rien à confirmer."""
    in_organization(
        disbursement.beneficiary_organization_id, restore_organization_id=disbursement.organization_id,
        action=lambda: close(disbursement, DISBURSEMENT_TO_CONFIRM),
    )


def reservation_ended(reservation, *, actor):
    """R9 — annulation par l'équipe ou expiration : le client est prévenu
    (notification, close quand il la marque vue). Rien quand il annule
    lui-même."""
    from apps.organizations.identity import actor_label

    if reservation.status == 'cancelled' and reservation.cancelled_by_id == reservation.client_id:
        return
    by_label = actor_label(reservation.cancelled_by, GESTIONNAIRE_ROLE_CODE) if reservation.cancelled_by_id else ''
    ensure_task(
        subject=reservation, organization_id=reservation.organization_id, assignees=[reservation.client],
        source=RESERVATION_ENDED, label=services._reservation_ended_label(reservation, by_label),
        program=reservation.lot.asset.program, task_type=TaskType.NOTIFICATION, priority=TaskPriority.HIGH,
    )
