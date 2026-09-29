"""PO-2026-09-29-09 — ordre du scénario (CDC §9.2) : le chantier d'un lot ne
s'ouvre qu'après la concrétisation de son dossier. Constat de la
vérification finale : le constructeur avait pu déclarer « Fondations » sur
A2 et y déposer une pièce avant l'examen du dossier d'Awa, puis être payé
avant la concrétisation. Refuser la déclaration ferme toute la chaîne
(pièce, contrôle, acceptation, décaissement), qui part d'une déclaration."""
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.core.rls import set_rls_context
from apps.evidence.models import WorkDeclaration
from apps.inspections import services as inspections_services
from apps.sales.models import Reservation, ReservationStatus
from apps.sales.services import CHANTIER_NOT_OPEN_MESSAGE
from apps.sales.testing import commit_lot

from .tests import _setup_org_with_lot


def _reservation(lot, status, email):
    from apps.accounts.models import User

    client = User.objects.create_user(email=email)
    set_rls_context(organization_id=lot.organization_id)
    return Reservation.objects.create(
        organization_id=lot.organization_id, lot_id=lot.id, client=client, status=status,
        held_until=timezone.now() + timedelta(days=1), price_amount=0,
    )


def _fondations(builder, lot):
    response = builder.get(reverse('build-lot-milestones', args=[lot.id]))
    assert response.status_code == 200, response.data
    return next(row for row in response.data if row['code'] == 'fondations')


def _declare(builder, milestone_id):
    return builder.post(reverse('workdeclaration-list'), {'milestone': milestone_id}, format='json')


@pytest.mark.django_db
class TestChantierOpensAfterCommitment:
    def _setup(self, suffix):
        builder, organization, _user, _program, _asset, lot = _setup_org_with_lot(
            f'ordre-{suffix}@example.com', f'Org ordre {suffix}', role_code='constructeur',
        )
        return builder, organization, lot

    def test_no_dossier_the_declaration_is_refused_and_nothing_is_created(self):
        builder, organization, lot = self._setup('aucun')
        fondations = _fondations(builder, lot)
        assert fondations['chantier_open'] is False
        assert fondations['chantier_hint'] == CHANTIER_NOT_OPEN_MESSAGE

        response = _declare(builder, fondations['id'])

        assert response.status_code == 400
        assert response.data['milestone'] == [CHANTIER_NOT_OPEN_MESSAGE]
        set_rls_context(organization_id=organization.id)
        assert not WorkDeclaration.objects.filter(milestone_id=fondations['id']).exists()
        assert _fondations(builder, lot)['status'] == 'not_declared'

    @pytest.mark.parametrize('status', [
        ReservationStatus.HELD, ReservationStatus.RESERVED, ReservationStatus.EXPIRED, ReservationStatus.CANCELLED,
    ])
    def test_a_dossier_not_yet_committed_keeps_the_chantier_closed(self, status):
        builder, _organization, lot = self._setup(f'statut-{status}')
        _reservation(lot, status, f'client-{status}@example.com')

        response = _declare(builder, _fondations(builder, lot)['id'])

        assert response.status_code == 400
        assert response.data['milestone'] == [CHANTIER_NOT_OPEN_MESSAGE]

    def test_once_committed_the_builder_declares(self):
        builder, _organization, lot = self._setup('concretise')
        _reservation(lot, ReservationStatus.EXPIRED, 'client-expire@example.com')
        commit_lot(lot)

        fondations = _fondations(builder, lot)
        assert fondations['chantier_open'] is True
        assert fondations['chantier_hint'] == ''
        response = _declare(builder, fondations['id'])

        assert response.status_code == 201, response.data
        assert _fondations(builder, lot)['status'] == 'awaiting_documents'

    def test_all_lots_says_who_acts_before_the_chantier(self):
        builder, _organization, lot = self._setup('tous-les-lots')
        row = builder.get(reverse('build-lots')).data['results'][0]
        assert (row['next_step'], row['next_actor']) == inspections_services.CHANTIER_NOT_OPEN_STEP

        commit_lot(lot)
        row = builder.get(reverse('build-lots')).data['results'][0]
        assert row['next_actor'] == 'Constructeur'
        assert row['next_step'].startswith('Déclaration de')


def test_lot_next_step_without_commitment_points_to_the_dossier():
    rows = [{'cdc_state': inspections_services.CDC_DRAFT, 'label': 'Fondations', 'control_scheduled': False}]
    assert inspections_services.lot_next_step(rows, chantier_open=False) == inspections_services.CHANTIER_NOT_OPEN_STEP
    assert inspections_services.lot_next_step(rows)[1] == 'Constructeur'
    # Un chantier commencé avant la règle garde sa prochaine étape de chantier.
    started = [{'cdc_state': inspections_services.CDC_SUBMITTED, 'label': 'Fondations', 'control_scheduled': False}]
    assert inspections_services.lot_next_step(started, chantier_open=False)[1] == 'Gestionnaire'
