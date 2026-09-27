"""Audit UI R1 — étape 3 (design system, PO-2026-09-27-20) : libellés serveur.

A-DS-4 : états de jalon affichés selon le CDC §7.1, dérivés côté serveur.
A-DS-6 et glossaire (DESIGN_SYSTEM §8.3) : libellés d'états des objets métier.
"""
import pytest
from django.urls import reverse

from apps.inspections import services as inspections_services
from apps.inspections.services import milestone_cdc_state

from .models import (
    ContractStatus, DisbursementFlowStatus, DisbursementStatus, FlowStatus, ReservationStatus,
)
from .test_audit_ui_r1 import CONSTRUCTEUR, INSPECTEUR, _declared_foundations, _login, _opinion


class TestGlossaryLabels:
    """DESIGN_SYSTEM §8.3 (PO-2026-09-27-20)."""

    def test_business_state_labels_follow_the_glossary(self):
        assert ReservationStatus.HELD.label == 'Bien bloqué'  # A-DS-6
        assert ContractStatus.SIGNED_SIMULATED.label == 'Signé (simulé)'
        assert DisbursementStatus.ELIGIBLE.label == 'Éligible'
        assert DisbursementFlowStatus.PLANNED.label == 'Planifié'
        assert DisbursementFlowStatus.BANK_EXECUTED_SIM.label == 'Exécuté par la banque (simulé)'
        assert FlowStatus.BANK_EXECUTED_SIM.label == 'Exécuté par la banque (simulé)'


def _state(status, *, correction=False, mission=None):
    return {'status': status, 'correction_submitted': correction, 'pending_mission': mission}


class TestMilestoneCdcStateDerivation:
    """A-DS-4 : table de dérivation, sans changement de modèle."""

    @pytest.mark.parametrize(('state', 'expected'), [
        (_state(inspections_services.NOT_DECLARED), ('DRAFT', 'Brouillon', 'Jalon pas encore déclaré')),
        (_state(inspections_services.AWAITING_DOCUMENTS), ('DRAFT', 'Brouillon', 'Déclaré — pièce à joindre')),
        (_state(inspections_services.AWAITING_CONTROL), ('SUBMITTED', 'Soumis', '')),
        (_state(inspections_services.AWAITING_CONTROL, mission=object()), ('UNDER_REVIEW', 'En examen', '')),
        (_state(inspections_services.UNDER_RESERVE), ('CHANGES_REQUESTED', 'Corrections demandées', '')),
        (_state(inspections_services.UNDER_RESERVE, correction=True), ('RESUBMITTED', 'Resoumis', '')),
        (_state(inspections_services.ACCEPTED), ('TECHNICALLY_ACCEPTED', 'Accepté techniquement', '')),
    ])
    def test_each_control_state_maps_to_one_cdc_state(self, state, expected):
        assert milestone_cdc_state(state) == expected


def _builder_milestones(builder, lot_id):
    response = builder.get(reverse('build-lot-milestones', args=[lot_id]))
    assert response.status_code == 200, response.data
    return {row['code']: row for row in response.data}


@pytest.mark.django_db
class TestMilestoneCdcStateThroughTheApi:
    def test_the_builder_sees_cdc_states_through_the_whole_cycle(self):
        builder, _promoter, milestone, _declaration_id, _evidence_id, _document_id, mission_id = _declared_foundations()
        lot_id = milestone.lot_id
        rows = _builder_milestones(builder, lot_id)
        # Contrôleur affecté, pas encore d'avis : « En examen ».
        assert (rows['fondations']['cdc_state'], rows['fondations']['status_label']) == ('UNDER_REVIEW', 'En examen')
        others = [row for code, row in rows.items() if code != 'fondations']
        assert others and all(row['status_label'] == 'Brouillon' for row in others)
        assert all(row['status_hint'] == 'Jalon pas encore déclaré' for row in others)

        response = _opinion(_login(INSPECTEUR), mission_id, outcome='avec_reserve', reserves=[{
            'motif': 'Fissure en pied de mur', 'expected_action': 'Reprendre l’enduit',
        }])
        assert response.status_code in (200, 201), response.data
        rows = _builder_milestones(_login(CONSTRUCTEUR), lot_id)
        assert (rows['fondations']['cdc_state'], rows['fondations']['status_label']) == (
            'CHANGES_REQUESTED', 'Corrections demandées',
        )

    def test_public_worksites_use_the_cdc_labels(self):
        _declared_foundations()
        from rest_framework.test import APIClient

        worksites = APIClient().get(reverse('public-worksites')).data
        labels = {milestone['status_label'] for worksite in worksites for milestone in worksite['milestones']}
        assert labels <= set(inspections_services.CDC_STATE_LABELS.values())
        assert 'En examen' in labels
