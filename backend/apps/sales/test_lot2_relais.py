"""Lot 2 — Relais (PO-2026-09-28-44, frictions P08 à P11, P28, P33) et
PO-2026-09-28-57 (suspension de l'échéance expliquée).

Chaque transition crée une entrée « À faire » pour le rôle qui doit agir
ensuite ; l'entrée disparaît quand l'action est faite. La cloche compte les
entrées en attente.
"""
import pytest
from django.urls import reverse

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.inspections.models import Reserve
from apps.programs.models import Lot, Milestone
from apps.tasks import relays
from apps.tasks.models import Task, TaskStatus, TaskType

from .models import Reservation, ReservationStatus
from .testing import commit_lot
from .test_audit_ui_r1 import (
    ADV, CONSTRUCTEUR, FINANCE, INSPECTEUR, _add_evidence, _assign, _login, _opinion, _promoter_lot, _seed,
)
from .test_audit_ui_r1_step2 import CLIENT, _reserve_and_examine, _signal_fees
from .tests import (
    _action, _age_hold, _allocate, _disbursement_scenario, _executed_disbursement, _issue, _receipt, _reconcile, _register,
    _reserve, _published_lot,
)


def _pending(organization, email=None):
    """Sources (sans suffixe de destinataire) des entrées en attente d'une
    organisation, éventuellement pour un seul compte."""
    set_rls_context(organization_id=organization.id)
    tasks = Task.objects.filter(organization=organization, status=TaskStatus.PENDING)
    if email:
        tasks = tasks.filter(assignee__email=email)
    return sorted(task.source.split(':')[0] for task in tasks)


def _label(organization, source, email):
    set_rls_context(organization_id=organization.id)
    return Task.objects.get(
        organization=organization, status=TaskStatus.PENDING, source__startswith=source, assignee__email=email,
    ).label


def _fees_paid_directly(promoter, reservation_id):
    """Flux Finance direct (sans signalement du client) : frais enregistrés,
    affectés et rapprochés."""
    finance = _login(FINANCE)
    calls = finance.get(
        reverse('finance-file', args=[reservation_id]) + f'?organization_id={promoter.id}',
    ).data['calls']
    fees = next(call for call in calls if call['kind'] == 'frais')
    receipt = _receipt(finance, promoter, reservation_id, '100000.00').data
    assert _allocate(finance, promoter, receipt['id'], fees['id'], '100000.00').status_code == 201
    assert _reconcile(finance, promoter, receipt['id']).status_code == 200


def _declare_foundations(builder, promoter, lot):
    set_rls_context(organization_id=promoter.id)
    milestone = Milestone.objects.get(lot=lot, code='fondations')
    commit_lot(lot)  # PO-2026-09-29-09 : chantier ouvert après concrétisation
    declared = builder.post(reverse('workdeclaration-list'), {'milestone': str(milestone.id)}, format='json')
    assert declared.status_code == 201, declared.data
    return milestone, str(declared.data['id'])


@pytest.mark.django_db
class TestR1ComplementAndR8PaidCall:
    """P08 — frais rapprochés : le gestionnaire appelle le complément. P33
    (R8) — l'appel réglé par le flux Finance direct n'est plus « à régler »."""

    def test_reserved_creates_the_complement_task_closed_when_the_call_is_issued(self):
        client, adv, promoter, reservation_id = _reserve_and_examine()
        assert 'payment_call_to_pay' in _pending(promoter, CLIENT)

        _fees_paid_directly(promoter, reservation_id)

        assert 'complement_to_call' in _pending(promoter, ADV)
        label = _label(promoter, 'complement_to_call', ADV)
        assert label.startswith('Appeler le complément du premier versement — ')
        assert 'Awa Koné · Cliente fictive' in label and '@' not in label
        assert 'payment_call_to_pay' not in _pending(promoter, CLIENT)

        assert _issue(adv, reservation_id, promoter, 'premier_versement').status_code == 201

        assert 'complement_to_call' not in _pending(promoter, ADV)
        assert 'payment_call_to_pay' in _pending(promoter, CLIENT)


@pytest.mark.django_db
class TestR2R7R3ControlRelays:
    """P09 — jalon soumis : affectation du contrôle ; R7 — la mission du
    contrôleur se ferme à l'avis ; P10 (R3) — jalon accepté : Finance."""

    def test_submission_assignment_opinion_chain(self):
        _seed()
        builder = _login(CONSTRUCTEUR)
        promoter, lot = _promoter_lot()
        _milestone, declaration_id = _declare_foundations(builder, promoter, lot)
        assert 'control_to_assign' not in _pending(promoter, ADV)  # déclaré, sans pièce

        _add_evidence(builder, declaration_id)

        assert 'control_to_assign' in _pending(promoter, ADV)
        assert _label(promoter, 'control_to_assign', ADV) == (
            'Affecter le contrôleur — Lot A1 · Fondations (jalon soumis par le constructeur)'
        )

        mission_id = _assign(_login(ADV), promoter, declaration_id)

        assert 'control_to_assign' not in _pending(promoter, ADV)
        assert 'mission_assigned' in _pending(promoter, INSPECTEUR)

        assert _opinion(_login(INSPECTEUR), mission_id, outcome='conforme').status_code == 201

        assert 'mission_assigned' not in _pending(promoter, INSPECTEUR)
        assert 'milestone_disbursable' in _pending(promoter, FINANCE)
        assert 'Lot A1 · Fondations' in _label(promoter, 'milestone_disbursable', FINANCE)


@pytest.mark.django_db
class TestR6Recontrol:
    """R6 — la tâche « réserve » du constructeur se ferme à sa correction ;
    le recontrôle est à affecter (même entrée, remise en attente)."""

    def test_correction_closes_the_builder_task_and_reopens_the_assignment(self):
        _seed()
        builder = _login(CONSTRUCTEUR)
        promoter, lot = _promoter_lot()
        _milestone, declaration_id = _declare_foundations(builder, promoter, lot)
        _add_evidence(builder, declaration_id)
        mission_id = _assign(_login(ADV), promoter, declaration_id)
        opened = _opinion(_login(INSPECTEUR), mission_id, outcome='avec_reserve', reserves=[
            {'motif': 'Enrobage insuffisant', 'expected_action': 'Reprendre l’enrobage'},
        ])
        assert opened.status_code == 201, opened.data
        assert 'reserve_opened' in _pending(promoter, CONSTRUCTEUR)
        assert 'control_to_assign' not in _pending(promoter, ADV)  # au constructeur d'agir

        set_rls_context(organization_id=promoter.id)
        reserve = Reserve.objects.get(opened_by_inspection_id=opened.data['inspection_id'])
        evidence_id, _document = _add_evidence(builder, declaration_id)
        corrected = builder.post(
            reverse('reservecorrection-list'), {'reserve': str(reserve.id), 'evidence': evidence_id}, format='json',
        )
        assert corrected.status_code == 201, corrected.data

        assert 'reserve_opened' not in _pending(promoter, CONSTRUCTEUR)
        assert 'control_to_assign' in _pending(promoter, ADV)
        assert 'recontrôle après correction' in _label(promoter, 'control_to_assign', ADV)
        set_rls_context(organization_id=promoter.id)
        assert Task.objects.filter(source__startswith='control_to_assign', assignee__email=ADV).count() == 1


@pytest.mark.django_db
class TestR4DeclareAfterCommitment:
    """P11 — dossier concrétisé : le constructeur déclare le premier jalon ;
    le suivant seulement après acceptation du précédent (P21)."""

    def test_the_builder_is_asked_to_declare_one_milestone_at_a_time(self):
        _seed()
        promoter, lot = _promoter_lot()
        client = _login(CLIENT)
        reservation = client.post(
            reverse('reservation-create'), {'lot': str(lot.id), 'organization': str(promoter.id)}, format='json',
        )
        assert reservation.status_code == 201, reservation.data
        set_rls_context(organization_id=promoter.id)
        Reservation.objects.filter(id=reservation.data['id']).update(status=ReservationStatus.COMMITTED)
        relays.sync_lot_relays(Lot.objects.get(id=lot.id), actor=User.objects.get(email=ADV))

        assert 'milestone_to_declare' in _pending(promoter, CONSTRUCTEUR)
        assert _label(promoter, 'milestone_to_declare', CONSTRUCTEUR) == 'Déclarer le jalon « Fondations » — Lot A1'

        builder = _login(CONSTRUCTEUR)
        _milestone, declaration_id = _declare_foundations(builder, promoter, lot)
        _add_evidence(builder, declaration_id)

        # Fondations soumis, pas encore accepté : rien d'autre à déclarer.
        assert 'milestone_to_declare' not in _pending(promoter, CONSTRUCTEUR)

        mission_id = _assign(_login(ADV), promoter, declaration_id)
        assert _opinion(_login(INSPECTEUR), mission_id, outcome='conforme').status_code == 201

        assert _label(promoter, 'milestone_to_declare', CONSTRUCTEUR) == 'Déclarer le jalon « Élévation » — Lot A1'


@pytest.mark.django_db
class TestR5ConfirmReceipt:
    """P11 (R5) — décaissement exécuté : le constructeur bénéficiaire peut
    confirmer ; sa tâche vit dans SA organisation (prestataire affecté)."""

    def test_execution_asks_the_beneficiary_then_confirmation_closes_it(self):
        s = _disbursement_scenario()
        _milestone, executed = _executed_disbursement(s)

        org = s['constructeur_org']
        assert _pending(org) == ['disbursement_to_confirm']
        assert 'milestone_disbursable' not in _pending(s['promoter'])

        confirmed = s['constructeur'].post(reverse('beneficiary-disbursement-confirm', args=[executed['id']]))
        assert confirmed.status_code == 200, confirmed.data

        assert _pending(org) == []

    def test_reconciliation_without_confirmation_also_closes_it(self):
        s = _disbursement_scenario()
        _milestone, executed = _executed_disbursement(s)

        reconciled = _action(s, 'reconcile', executed['id'], {'reason': 'Confirmation bénéficiaire non reçue'})
        assert reconciled.status_code == 200, reconciled.data

        assert _pending(s['constructeur_org']) == []


@pytest.mark.django_db
class TestR9ClientIsToldWhenTheReservationEnds:
    """P28 (R9) — annulation par l'équipe ou expiration : notification au
    client ; rien quand il annule lui-même."""

    def test_team_cancellation_notifies_the_client(self):
        client, adv, promoter, reservation_id = _reserve_and_examine()
        adv.post(
            reverse('reservation-admin-cancel', args=[reservation_id]) + f'?organization_id={promoter.id}',
            {'reason': 'Dossier incomplet (motif fictif)'}, format='json',
        )

        assert _pending(promoter, CLIENT) == ['reservation_ended']
        set_rls_context(organization_id=promoter.id)
        task = Task.objects.get(source__startswith='reservation_ended')
        assert task.type == TaskType.NOTIFICATION
        assert task.label.startswith('Réservation annulée le ')
        assert ' par KEYIMMO AFRIC (démo) · Gestionnaire — motif : Dossier incomplet (motif fictif)' in task.label
        assert '(GMT, Abidjan)' in task.label

    def test_expiry_notifies_the_client_and_closes_the_call_to_pay(self):
        client, _adv, promoter, reservation_id = _reserve_and_examine()
        _age_hold(promoter, reservation_id)

        client.get(reverse('my-reservations'))  # expiration appliquée à la lecture

        assert _pending(promoter, CLIENT) == ['reservation_ended']
        set_rls_context(organization_id=promoter.id)
        assert Task.objects.get(source__startswith='reservation_ended').label.startswith('Blocage expiré le ')

    def test_a_client_cancelling_is_not_notified(self):
        client, _user, _org = _register()
        _admin, promoter, lot = _published_lot()
        reservation_id = _reserve(client, promoter, lot).data['id']

        client.post(reverse('my-reservation-cancel', args=[reservation_id]))

        set_rls_context(organization_id=promoter.id)
        assert not Task.objects.filter(source__startswith='reservation_ended').exists()


@pytest.mark.django_db
class TestPO57HoldSuspensionIsExplained:
    """PO-2026-09-28-57 — l'échéance suspendue est expliquée au client."""

    def test_a_signalled_transfer_suspends_the_hold_and_says_why(self):
        client, _adv, _promoter, reservation_id = _reserve_and_examine()
        mine = lambda: next(r for r in client.get(reverse('my-reservations')).data if r['id'] == reservation_id)  # noqa: E731
        assert mine()['hold_suspension'] is None

        _signal_fees(client, reservation_id)

        assert mine()['hold_suspension'] == 'notice_declared'

    def test_a_recorded_receipt_suspends_the_hold_for_finance_review(self):
        client, _adv, promoter, reservation_id = _reserve_and_examine()
        finance = _login(FINANCE)
        assert _receipt(finance, promoter, reservation_id, '40000.00').status_code == 201

        row = next(r for r in client.get(reverse('my-reservations')).data if r['id'] == reservation_id)
        assert row['status'] == ReservationStatus.HELD
        assert row['hold_suspension'] == 'receipt'
