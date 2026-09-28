"""Audit UI R1 — étape 7 : décisions du Product Owner (PO-2026-09-28-30 à 36).

Chaque classe cite la décision liée.
"""
import pytest
from django.test import override_settings
from django.urls import reverse

from .test_audit_ui_r1 import INSPECTEUR, _declared_foundations, _login
from .tests import _register

SYNC_ROUTES = ('control-sync-document', 'control-sync-evidence', 'control-sync-inspection')


@pytest.mark.django_db
class TestOfflineSyncIsCutInTheMvp:
    """PO-2026-09-28-30 (K04) — les routes de synchronisation hors ligne sont
    coupées derrière un réglage désactivé par défaut : « introuvable »."""

    @override_settings(KEYA_OFFLINE_SYNC_ENABLED=False)
    def test_every_sync_route_answers_not_found(self):
        _declared_foundations()
        inspector = _login(INSPECTEUR)
        for name in SYNC_ROUTES:
            response = inspector.post(reverse(name), {}, format='json')
            assert response.status_code == 404, (name, response.status_code)

    def test_the_setting_is_off_by_default(self):
        from decouple import config
        from django.conf import settings as project_settings

        assert config('KEYA_OFFLINE_SYNC_ENABLED', default=False, cast=bool) is False
        assert hasattr(project_settings, 'KEYA_OFFLINE_SYNC_ENABLED')


@pytest.mark.django_db
class TestInspectorActsOnlyOnAssignedMissions:
    """PO-2026-09-28-30 — un contrôleur n'agit que sur une mission qui lui
    est affectée, par TOUTES les routes restantes : liste, fiche, pièce,
    avis de la mission, avis direct (`POST /api/inspections/`), réserves."""

    def test_an_unassigned_inspector_is_refused_everywhere(self):
        _builder, promoter, _milestone, declaration_id, evidence_id, document_id, mission_id = _declared_foundations()
        other, _user, _organization = _register('inspecteur')

        missions = other.get(reverse('control-mission-list'))
        assert missions.status_code == 200
        assert mission_id not in [row['id'] for row in missions.data]
        assert other.get(reverse('control-mission-detail', args=[mission_id])).status_code == 404
        assert other.get(reverse('control-mission-document', args=[mission_id, document_id])).status_code == 404
        opinion = other.post(reverse('control-mission-opinion', args=[mission_id]), {
            'outcome': 'conforme', 'examined_evidence_ids': [evidence_id],
        }, format='json')
        assert opinion.status_code == 404
        direct = other.post(reverse('inspection-list'), {
            'organization': str(promoter.id), 'work_declaration': declaration_id, 'outcome': 'conforme',
            'examined_evidence_ids': [evidence_id],
        }, format='json')
        assert direct.status_code == 404, direct.data
        assert other.get(reverse('reserve-list')).data in ([], {'count': 0, 'next': None, 'previous': None, 'results': []})

    def test_the_assigned_inspector_can_act_through_the_direct_route(self):
        _builder, promoter, _milestone, declaration_id, evidence_id, _document_id, _mission_id = _declared_foundations()
        response = _login(INSPECTEUR).post(reverse('inspection-list'), {
            'organization': str(promoter.id), 'work_declaration': declaration_id, 'outcome': 'conforme',
            'examined_evidence_ids': [evidence_id],
        }, format='json')
        assert response.status_code == 201, response.data


# ─── PO-2026-09-28-31 : états du jalon ──────────────────────────────────────

from apps.audit.models import AuditEvent  # noqa: E402
from apps.core.rls import set_rls_context  # noqa: E402
from apps.inspections import services as inspections_services  # noqa: E402
from apps.inspections.models import Inspection, InspectionMission  # noqa: E402
from apps.programs.models import Lot  # noqa: E402
from apps.trust.models import TrustEvent  # noqa: E402

from .tests import _accept_with_evidence, _action, _add_evidence, _disbursement_scenario, _prepare  # noqa: E402


@pytest.mark.django_db
class TestReviewRequiredIsAComputedDisplayState:
    """PO-2026-09-28-31 (T07) — « Nouvelle revue nécessaire » : état calculé
    pour l'affichage, sans transition ni écriture, qui bloque tout nouveau
    décaissement."""

    def test_computed_without_writing_and_blocking_a_new_disbursement(self):
        s = _disbursement_scenario()
        milestone, declaration = _accept_with_evidence(s['promoter'], s['lot']['id'], 'fondations', s['constructeur_user'])
        _add_evidence(s['promoter'], declaration, s['constructeur_user'])

        set_rls_context(organization_id=s['promoter'].id)
        lot = Lot.objects.get(id=s['lot']['id'])
        before = (Inspection.objects.count(), TrustEvent.objects.count(), AuditEvent.objects.count(),
                  InspectionMission.objects.count())
        rows = inspections_services.milestone_gauge_rows(lot)
        inspections_services.milestone_gauge_rows(lot)
        after = (Inspection.objects.count(), TrustEvent.objects.count(), AuditEvent.objects.count(),
                 InspectionMission.objects.count())
        fondations = next(row for row in rows if row['code'] == 'fondations')
        assert (fondations['cdc_state'], fondations['status_label']) == ('REVIEW_REQUIRED', 'Nouvelle revue nécessaire')
        assert before == after  # lecture seule : aucune transition enregistrée
        assert inspections_services.is_milestone_technically_accepted(milestone) is False

        prepared = _prepare(s, milestone)
        if prepared.status_code == 201:
            assert _action(s, 'eligibility', prepared.data['id']).status_code == 409
        else:
            assert prepared.status_code in (400, 409), prepared.data

    def test_the_client_reads_not_yet_declared_where_workspaces_read_draft(self):
        state = {'status': inspections_services.NOT_DECLARED, 'pending_mission': None, 'correction_submitted': False}
        assert inspections_services.milestone_cdc_state(state)[:2] == ('DRAFT', 'Brouillon')
        assert inspections_services.milestone_cdc_state(state, audience='client') == ('DRAFT', 'Pas encore déclaré', '')

    def test_next_actor_without_a_scheduled_control_is_the_manager_assigning_it(self):
        """PO-2026-09-28-33."""
        for state in ('RESUBMITTED', 'REVIEW_REQUIRED'):
            assert inspections_services.milestone_next_step('Fondations', state, False)[1] == \
                'Gestionnaire (affectation du contrôle)'
            assert inspections_services.milestone_next_step('Fondations', state, True)[1] == 'Contrôleur'


# ─── PO-2026-09-28-34 et -36 : personnes dans le back-office et la messagerie ─

import re  # noqa: E402

from .test_audit_ui_r1 import ADV, CONSTRUCTEUR, _promoter_lot  # noqa: E402
from .test_audit_ui_r1_step2 import _reserve_and_examine  # noqa: E402

EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')


@pytest.mark.django_db
class TestPeopleLabels:
    def test_the_client_reads_fictive_name_then_client_in_back_office_lists(self):
        """PO-2026-09-28-34, précisé par -40 : « Awa Koné · Cliente fictive »."""
        _reserve_and_examine()
        rows = _login(ADV).get(reverse('reservation-admin-list')).data
        rows = rows['results'] if isinstance(rows, dict) else rows
        client = next(row['client'] for row in rows if row['lot']['name'] == 'Lot A1')
        # Adapté selon PO-2026-09-28-40 : rôle venu du jeu de démo.
        assert client['role'] == 'Cliente fictive'
        assert client['label'] == f"{client['full_name']} · Cliente fictive"
        assert client['label'].startswith('Awa Koné')

    def test_messages_name_their_author_by_organization_and_role(self):
        """PO-2026-09-28-36 : messagerie « organisation · rôle », jamais l'e-mail."""
        _reserve_and_examine()
        promoter, lot = _promoter_lot()
        builder = _login(CONSTRUCTEUR)
        posted = builder.post(reverse('lot-messages', args=[lot.id]), {'body': 'Coulage prévu lundi.'}, format='json')
        assert posted.status_code == 201, posted.data
        assert posted.data['author'] == 'Constructeur Démonstration Abidjan · Constructeur'
        thread = builder.get(reverse('lot-messages', args=[lot.id])).data
        assert EMAIL.findall(str(thread)) == []
