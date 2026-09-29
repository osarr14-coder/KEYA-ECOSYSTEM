"""Audit UI R1 — étape 5 : décisions du Product Owner (PO-2026-09-28-12 à 19).

Chaque classe cite la décision et, le cas échéant, l'exigence CDC liée.
"""
import pytest
from django.urls import reverse

from apps.core.rls import set_rls_context
from apps.inspections.models import Inspection
from apps.programs.models import Lot, Milestone

from apps.inspections.models import Reserve

from .test_audit_ui_r1 import (
    ADV, CONSTRUCTEUR, INSPECTEUR, _add_evidence, _assign, _client_reservation_id, _declared_foundations, _login,
    _opinion,
    _promoter_lot, _seed,
)
from .test_audit_ui_r1_step2 import CLIENT as CLIENT_EMAIL
from .testing import commit_lot

BUILDER_LABEL = 'Constructeur Démonstration Abidjan · Constructeur'
CONTROLLER_LABEL = 'Bureau de contrôle Démonstration · Contrôleur'


def _build_rows(lot_id):
    response = _login(CONSTRUCTEUR).get(reverse('build-lot-milestones', args=[lot_id]))
    assert response.status_code == 200, response.data
    return {row['code']: row for row in response.data}


def _with_reserve():
    # PO-2026-09-29-09 : le client réserve A1 avant le chantier.
    builder, promoter, milestone, declaration_id, _e, _doc, mission_id = _declared_foundations(client_email=CLIENT_EMAIL)
    opened = _opinion(_login(INSPECTEUR), mission_id, outcome='avec_reserve', reserves=[
        {'motif': 'Enrobage insuffisant', 'expected_action': 'Reprendre l’enrobage'},
    ])
    assert opened.status_code == 201, opened.data
    set_rls_context(organization_id=promoter.id)
    reserve = Reserve.objects.get(opened_by_inspection_id=opened.data['inspection_id'])
    return builder, promoter, milestone, declaration_id, reserve


def _worksite(promoter, milestone):
    client = _login(CLIENT_EMAIL)
    reservation_id = _client_reservation_id(client, milestone.lot_id)
    return lambda: {row['code']: row for row in client.get(reverse('my-worksite', args=[reservation_id])).data}


def _inspection_count(promoter):
    set_rls_context(organization_id=promoter.id)
    return Inspection.objects.filter(organization=promoter).count()


@pytest.mark.django_db
class TestAnOpinionDesignatesAtLeastOnePiece:
    """PO-2026-09-28-13 (K01, CDC §7.2) — refus serveur d'un avis sans pièce."""

    def test_an_explicit_empty_list_of_examined_pieces_is_refused(self):
        _b, promoter, _m, _d, _e, _doc, mission_id = _declared_foundations()
        before = _inspection_count(promoter)
        response = _opinion(_login(INSPECTEUR), mission_id, outcome='conforme', examined_evidence_ids=[])
        assert response.status_code == 400
        assert 'au moins une version de pièce' in str(response.data)
        assert _inspection_count(promoter) == before

    def test_a_declaration_without_any_piece_cannot_receive_an_opinion(self):
        _seed()
        builder = _login(CONSTRUCTEUR)
        promoter, lot = _promoter_lot()
        set_rls_context(organization_id=promoter.id)
        milestone = Milestone.objects.get(lot=lot, code='fondations')
        commit_lot(lot)  # PO-2026-09-29-09 : chantier ouvert après concrétisation
        declared = builder.post(reverse('workdeclaration-list'), {'milestone': str(milestone.id)}, format='json')
        assert declared.status_code == 201, declared.data
        mission_id = _assign(_login(ADV), promoter, str(declared.data['id']))
        before = _inspection_count(promoter)

        response = _opinion(_login(INSPECTEUR), mission_id, outcome='conforme')

        assert response.status_code == 400
        assert 'Aucune pièce' in str(response.data)
        assert _inspection_count(promoter) == before

    def test_an_absent_list_is_refused_like_an_empty_one(self):
        """Adapté selon PO-2026-09-28-20 : ce test vérifiait qu'une liste
        absente couvrait toutes les pièces soumises ; la désignation est
        désormais explicite, une liste absente est refusée."""
        builder, promoter, _m, declaration_id, evidence_id, _doc, mission_id = _declared_foundations()
        second_id, _second_doc = _add_evidence(builder, declaration_id)
        inspector = _login(INSPECTEUR)
        before = _inspection_count(promoter)
        refused = inspector.post(reverse('control-mission-opinion', args=[mission_id]), {'outcome': 'conforme'}, format='json')
        assert refused.status_code == 400
        assert 'explicitement' in str(refused.data)
        assert _inspection_count(promoter) == before

        response = _opinion(inspector, mission_id, outcome='conforme', examined_evidence_ids=[second_id])
        assert response.status_code == 201, response.data
        set_rls_context(organization_id=promoter.id)
        inspection = Inspection.objects.get(work_declaration_id=declaration_id)
        assert inspection.examined_evidence_ids == [second_id]


@pytest.mark.django_db
class TestOnlyTheManagerAssignsTheBuilderOrganization:
    """PO-2026-09-28-15 — affectation réservée au gestionnaire, côté serveur ;
    le constructeur la voit en lecture seule (test de refus)."""

    def test_the_demo_builder_is_refused_and_the_lot_is_unchanged(self):
        _seed()
        promoter, lot = _promoter_lot()
        before = lot.assigned_organization_id
        builder = _login(CONSTRUCTEUR)
        url = reverse('lot-assign-organization', args=[lot.id])
        for target in (url, f'{url}?organization_id={promoter.id}'):
            response = builder.post(target, {'organization_id': str(promoter.id)}, format='json')
            assert response.status_code == 403, response.data
        set_rls_context(organization_id=promoter.id)
        assert Lot.objects.get(id=lot.id).assigned_organization_id == before

    def test_the_manager_assigns_through_the_server_path(self):
        _seed()
        promoter, lot = _promoter_lot()
        response = _login(ADV).post(
            f"{reverse('lot-assign-organization', args=[lot.id])}?organization_id={promoter.id}",
            {'organization_id': str(promoter.id)}, format='json',
        )
        assert response.status_code == 200, response.data
        assert response.data['assigned_organization'] == promoter.id


@pytest.mark.django_db
class TestProgressIsACountOfAcceptedMilestones:
    """PO-2026-09-28-14 (CDC §1) — « n / N jalons acceptés techniquement »,
    aucun pourcentage dérivé des niveaux de confiance."""

    def test_the_lot_table_counts_accepted_milestones_only(self):
        _b, _p, milestone, _d, evidence_id, _doc, mission_id = _declared_foundations()
        builder = _login(CONSTRUCTEUR)
        row = next(r for r in builder.get(reverse('build-lots')).data['results'] if r['id'] == str(milestone.lot_id))
        assert 'progress_percentage' not in row
        assert (row['accepted_milestone_count'], row['milestone_count']) == (0, 2)
        assert _opinion(_login(INSPECTEUR), mission_id, outcome='conforme').status_code == 201
        row = next(r for r in builder.get(reverse('build-lots')).data['results'] if r['id'] == str(milestone.lot_id))
        assert (row['accepted_milestone_count'], row['milestone_count']) == (1, 2)


@pytest.mark.django_db
class TestOpenReservesAreVisible:
    """PO-2026-09-28-16 (CDC §9.2 étape 9)."""

    def test_the_builder_sees_motif_action_date_and_author_of_each_open_reserve(self):
        _builder, _promoter, milestone, _d, reserve = _with_reserve()
        [row] = _build_rows(milestone.lot_id)['fondations']['open_reserves']
        assert row['motif'] == 'Enrobage insuffisant'
        assert row['expected_action'] == 'Reprendre l’enrobage'
        assert row['opened_at'] == reserve.created_at.isoformat()
        assert row['opened_by'] == CONTROLLER_LABEL
        assert row['status_label'] == 'Ouverte'
        assert _build_rows(milestone.lot_id)['elevation']['open_reserves'] == []

    def test_the_client_reads_a_plain_summary_then_the_lift(self):
        builder, promoter, milestone, declaration_id, reserve = _with_reserve()
        worksite = _worksite(promoter, milestone)
        [summary] = worksite()['fondations']['reserves']
        assert set(summary) == {'motif', 'status', 'status_label', 'date'}  # aucun détail technique interne
        assert (summary['motif'], summary['status']) == ('Enrobage insuffisant', 'ouverte')
        assert summary['date'] == reserve.created_at.isoformat()

        correction_evidence, _doc = _add_evidence(builder, declaration_id)
        assert builder.post(
            reverse('reservecorrection-list'), {'reserve': str(reserve.id), 'evidence': correction_evidence}, format='json',
        ).status_code == 201
        follow_up = _assign(_login(ADV), promoter, declaration_id)
        lifted = _opinion(_login(INSPECTEUR), follow_up, outcome='conforme', decisions=[
            {'reserve_id': str(reserve.id), 'decision': 'levee', 'motif': 'Correction constatée'},
        ])
        assert lifted.status_code == 201, lifted.data
        [summary] = worksite()['fondations']['reserves']
        assert summary['status'] == 'levee'
        assert summary['status_label'].startswith('Levée')
        assert _build_rows(milestone.lot_id)['fondations']['open_reserves'] == []


@pytest.mark.django_db
class TestPersonsAreOrganisationAndRole:
    """PO-2026-09-28-18 — « organisation · rôle », jamais d'e-mail ni de
    double parenthèse : niveaux de confiance, pièces, chronologie."""

    def test_trust_levels_name_the_organisation_and_the_role(self):
        _b, _p, milestone, _d, _e, _doc, mission_id = _declared_foundations()
        assert _opinion(_login(INSPECTEUR), mission_id, outcome='conforme').status_code == 201
        levels = _build_rows(milestone.lot_id)['fondations']['trust_levels']
        assert (levels['declared']['by'], levels['declared']['role']) == (
            'Constructeur Démonstration Abidjan', 'Constructeur',
        )
        assert (levels['validated']['by'], levels['validated']['role']) == ('Bureau de contrôle Démonstration', 'Contrôleur')

    def test_no_email_in_the_builder_controller_and_client_views(self):
        builder, promoter, milestone, _d, _reserve = _with_reserve()
        worksite = _worksite(promoter, milestone)
        payloads = [
            _build_rows(milestone.lot_id),
            builder.get(reverse('build-exceptions')).data,
            worksite(),
        ]
        for payload in payloads:
            text = str(payload)
            assert '@' not in text, text
            assert '((' not in text and '))' not in text
        exceptions = payloads[1]
        [reserve_row] = exceptions['reserves_ouvertes']
        assert reserve_row['event']['actor'] == CONTROLLER_LABEL
        assert all(item['added_by'] == BUILDER_LABEL for item in reserve_row['available_evidence'])

    def test_the_controller_sees_pieces_by_organisation_and_role(self):
        _b, _p, _m, _d, _e, _doc, mission_id = _declared_foundations()
        detail = _login(INSPECTEUR).get(reverse('control-mission-detail', args=[mission_id])).data
        assert detail['declaration']['declared_by'] == BUILDER_LABEL
        assert detail['evidences'][0]['added_by'] == BUILDER_LABEL
        assert '@' not in str(detail)


@pytest.mark.django_db
class TestResetProcedureCheck:
    """PO-2026-09-28-19 (T14) — la vérification qui suit une réinitialisation
    accepte le jeu initial fraîchement posé et signale toute action déjà
    jouée. Lecture seule : elle ne crée rien."""

    def test_a_freshly_seeded_base_is_conforming(self):
        from io import StringIO

        from django.core.management import call_command

        _seed()
        out = StringIO()
        call_command('check_demo_dataset', stdout=out)
        assert 'ÉCART' not in out.getvalue()
        assert 'Base conforme au jeu initial DEMO-CI-v2.' in out.getvalue()  # PO-2026-09-28-63

    def test_a_played_step_is_reported_and_nothing_is_written(self):
        from io import StringIO

        from django.core.management import call_command
        from django.core.management.base import CommandError

        from apps.evidence.models import WorkDeclaration

        _b, promoter, _m, _d, _e, _doc, _mission = _declared_foundations()
        set_rls_context(organization_id=promoter.id)
        before = WorkDeclaration.objects.count()
        out = StringIO()
        with pytest.raises(CommandError):
            call_command('check_demo_dataset', stdout=out)
        assert 'ÉCART   Aucune action préremplie (parcours à jouer) — 1 déclarations' in out.getvalue()
        set_rls_context(organization_id=promoter.id)
        assert WorkDeclaration.objects.count() == before
