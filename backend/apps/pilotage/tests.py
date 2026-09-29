"""Lot 4 — pilotage minimal (PO-2026-09-28-46, CDC §9.2 étape 10, §9.3) et
arbitrages délégués PO-2026-09-28-63 à -67 : pièces exigées versionnées
(T18), indicateurs calculés avec leurs sources, chronologie du dossier."""
from datetime import timedelta
from unittest import mock

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.core.models import DemoInstance
from apps.core.rls import set_rls_context
from apps.inspections.models import Reserve
from apps.organizations.models import CountryPack
from apps.programs.models import Asset, Lot, Milestone, MilestoneTemplate, MilestoneTemplateStep
from apps.programs.services import instantiate_milestones_for_lot
from apps.sales.management.commands.seed_demo_scenario import REQUIRED_PIECES
from apps.sales.models import Reservation
from apps.sales.test_audit_ui_r1 import (
    ADMIN, ADV, CONSTRUCTEUR, FINANCE, INSPECTEUR, _assign, _login, _opinion, _pdf, _promoter_lot, _seed,
)
from apps.sales.test_audit_ui_r1_step2 import CLIENT, _reserve_and_examine
from apps.sales.test_lot2_relais import _declare_foundations, _fees_paid_directly
from apps.sales.tests import _disbursement_scenario, _executed_disbursement


def _indicators(user=ADV):
    response = _login(user).get(reverse('pilotage-indicators'))
    assert response.status_code == 200, response.data
    return response.data['indicators']


def _sources(key, user=ADV):
    response = _login(user).get(reverse('pilotage-indicator-sources', args=[key]))
    assert response.status_code == 200, response.data
    return response.data['sources']


def _deposit(builder, declaration_id, required_piece=''):
    document = builder.post(
        reverse('document-list'), {'file': _pdf(), 'category': 'preuve_chantier', 'source': 'control_tower_upload'},
        format='multipart',
    )
    assert document.status_code == 201, document.data
    return builder.post(reverse('evidence-list'), {
        'work_declaration': declaration_id, 'documents': [document.data['id']], 'required_piece': required_piece,
    }, format='json')


def _submitted_foundations(required_piece='plan_implantation'):
    _seed()
    builder = _login(CONSTRUCTEUR)
    promoter, lot = _promoter_lot()
    milestone, declaration_id = _declare_foundations(builder, promoter, lot)
    evidence = _deposit(builder, declaration_id, required_piece)
    assert evidence.status_code == 201, evidence.data
    return builder, promoter, lot, milestone, declaration_id, evidence.data['id']


@pytest.mark.django_db
class TestRequiredPiecesAreAVersionedCountryPackParameter:
    """PO-2026-09-28-63 (T18, A4)."""

    def test_the_demo_lots_carry_the_pieces_of_a4(self):
        _seed()
        promoter, lot = _promoter_lot()
        pieces = {
            milestone.code: [piece['label'] for piece in milestone.required_pieces]
            for milestone in Milestone.objects.filter(lot=lot)
        }
        assert pieces == {
            'fondations': [
                'Plan d’implantation', 'Photo des fouilles', 'Photo des armatures avant coulage',
                'Bon de livraison du béton',
            ],
            'elevation': ['Photo de chaque niveau', 'Photo des chaînages', 'Relevé de conformité aux plans'],
        }

    def test_t18_a_new_version_changes_new_lots_only(self):
        _seed()
        promoter, old_lot = _promoter_lot()
        country_pack = CountryPack.objects.get(code='CI')
        template = MilestoneTemplate.objects.create(country_pack=country_pack, version=99)
        MilestoneTemplateStep.objects.create(
            template=template, order=1, code='fondations', label='Fondations',
            required_pieces=[{'code': 'pv_implantation', 'label': 'PV d’implantation'}],
        )
        set_rls_context(organization_id=promoter.id)
        new_lot = Lot.objects.create(organization=promoter, asset=Asset.objects.filter(organization=promoter).first(), name='Lot A9')
        [milestone] = instantiate_milestones_for_lot(new_lot)

        assert milestone.required_pieces == [{'code': 'pv_implantation', 'label': 'PV d’implantation'}]
        old = Milestone.objects.get(lot=old_lot, code='fondations')
        assert [piece['code'] for piece in old.required_pieces] == [code for code, _ in REQUIRED_PIECES['fondations']]

    def test_a_deposit_names_a_required_piece_of_its_milestone_or_none(self):
        builder, _promoter, _lot, _milestone, declaration_id, _evidence = _submitted_foundations()

        refused = _deposit(builder, declaration_id, 'photo_chainages')  # pièce de l'Élévation

        assert refused.status_code == 400
        assert 'required_piece' in refused.data
        assert _deposit(builder, declaration_id, '').status_code == 201  # « Autre pièce »

    def test_build_shows_each_required_piece_with_its_presence(self):
        builder, promoter, lot, _milestone, _declaration_id, _evidence = _submitted_foundations()

        rows = builder.get(reverse('build-lot-milestones', args=[lot.id])).data
        foundations = next(row for row in rows if row['code'] == 'fondations')

        assert [(piece['code'], piece['deposited']) for piece in foundations['required_pieces']] == [
            ('plan_implantation', True), ('photo_fouilles', False), ('photo_armatures', False),
            ('bon_livraison_beton', False),
        ]
        assert all(piece['examined'] is None for piece in foundations['required_pieces'])


@pytest.mark.django_db
class TestIndicators:
    def test_a_fresh_instance_is_not_applicable_everywhere_never_100_percent(self):
        _seed()

        indicators = _indicators()

        for key in ('jalons', 'entrees', 'sorties', 'pieces'):
            assert (indicators[key]['numerator'], indicators[key]['denominator']) == (0, 0), key
        assert (indicators['reserves']['open'], indicators['reserves']['lifted']) == (0, 0)
        assert indicators['reserves']['oldest_open_days'] is None

    def test_pieces_count_presence_not_conformity(self):
        """PO-2026-09-28-64 : un avis conforme ne rend pas « déposée » une
        pièce absente ; l'examen est une colonne à part."""
        _builder, promoter, _lot, _milestone, declaration_id, evidence_id = _submitted_foundations()
        assert (_indicators()['pieces']['numerator'], _indicators()['pieces']['denominator']) == (1, 4)

        mission_id = _assign(_login(ADV), promoter, declaration_id)
        assert _opinion(_login(INSPECTEUR), mission_id, outcome='conforme').status_code == 201

        pieces = _indicators()['pieces']
        assert (pieces['numerator'], pieces['denominator']) == (1, 4)
        rows = {row['code']: row for row in _sources('pieces')}
        assert (rows['plan_implantation']['deposited'], rows['plan_implantation']['examined']) == (True, True)
        assert (rows['photo_fouilles']['deposited'], rows['photo_fouilles']['examined']) == (False, False)
        assert rows['plan_implantation']['milestone'] == 'Fondations'

    def test_examined_milestones_and_current_technical_acceptances_apart(self):
        _builder, promoter, _lot, _milestone, declaration_id, _evidence = _submitted_foundations()
        jalons = _indicators()['jalons']
        assert (jalons['numerator'], jalons['denominator'], jalons['technically_accepted']) == (0, 1, 0)

        mission_id = _assign(_login(ADV), promoter, declaration_id)
        assert _opinion(_login(INSPECTEUR), mission_id, outcome='conforme').status_code == 201

        jalons = _indicators()['jalons']
        assert (jalons['numerator'], jalons['denominator'], jalons['technically_accepted']) == (1, 1, 1)
        [row] = _sources('jalons')
        assert row['last_opinion']['outcome_label'] == 'Conforme'
        assert row['last_opinion']['by'] == 'Bureau de contrôle Démonstration · Contrôleur'
        assert row['status_label'] == 'Accepté techniquement'

    def test_reserves_open_then_lifted_with_server_side_age(self):
        builder, promoter, _lot, _milestone, declaration_id, _evidence = _submitted_foundations()
        inspector = _login(INSPECTEUR)
        mission_id = _assign(_login(ADV), promoter, declaration_id)
        opened = _opinion(inspector, mission_id, outcome='avec_reserve', reserves=[
            {'motif': 'Enrobage insuffisant', 'expected_action': 'Reprendre l’enrobage'},
        ])
        assert opened.status_code == 201, opened.data

        later = timezone.now() + timedelta(days=3, hours=2)
        with mock.patch('apps.pilotage.services.timezone.now', return_value=later):
            reserves = _indicators()['reserves']
            [row] = _sources('reserves')
        assert (reserves['open'], reserves['lifted'], reserves['oldest_open_days']) == (1, 0, 3)
        assert (row['motif'], row['milestone'], row['age_days'], row['is_open']) == (
            'Enrobage insuffisant', 'Fondations', 3, True,
        )

        set_rls_context(organization_id=promoter.id)
        reserve = Reserve.objects.get(opened_by_inspection_id=opened.data['inspection_id'])
        evidence = _deposit(builder, declaration_id, 'photo_armatures').data
        assert builder.post(
            reverse('reservecorrection-list'), {'reserve': str(reserve.id), 'evidence': evidence['id']}, format='json',
        ).status_code == 201
        follow_up = _assign(_login(ADV), promoter, declaration_id)
        lifted = _opinion(inspector, follow_up, outcome='conforme', decisions=[
            {'reserve_id': str(reserve.id), 'decision': 'levee', 'motif': 'Enrobage conforme'},
        ])
        assert lifted.status_code == 201, lifted.data

        reserves = _indicators()['reserves']
        assert (reserves['open'], reserves['lifted']) == (0, 1)
        [row] = _sources('reserves')
        assert row['is_lifted'] and row['lifted_at'] and row['status_label'] == 'Levée'

    def test_movements_entries_listed_outflows_only_as_a_total(self):
        """A3 (PO-2026-09-28-52, -66)."""
        s = _disbursement_scenario()
        _executed_disbursement(s)
        adv = s['adv']

        data = adv.get(reverse('pilotage-indicators')).data['indicators']

        assert (data['entrees']['numerator'], data['entrees']['denominator']) == (2, 2)
        assert (data['sorties']['numerator'], data['sorties']['denominator']) == (0, 1)
        assert data['sorties']['executed_amount'] == '1000000.00'
        outflows = adv.get(reverse('pilotage-indicator-sources', args=['sorties'])).data['sources']
        assert set(outflows) == {
            'executed', 'reconciled', 'executed_amount', 'reconciled_amount', 'currency', 'detail',
        }
        entries = adv.get(reverse('pilotage-indicator-sources', args=['entrees'])).data['sources']
        assert sorted(row['amount'] for row in entries) == ['100000.00', '2900000.00']
        assert all(row['reconciled'] for row in entries)

    def test_only_the_active_instance_is_counted(self):
        """CDC §9.3 : les archives (et les objets hors scénario) sont exclus."""
        s = _disbursement_scenario()
        _executed_disbursement(s)
        DemoInstance.objects.create(code='DEMO-CI-TEST-ACTIVE', dataset_version='DEMO-CI-v2')

        data = s['adv'].get(reverse('pilotage-indicators')).data['indicators']

        for key in ('jalons', 'entrees', 'sorties', 'pieces'):
            assert data[key]['denominator'] == 0, key

    def test_rights_are_checked_by_the_server_for_the_indicators_and_their_sources(self):
        _seed()
        for email in (FINANCE, ADMIN, CONSTRUCTEUR, INSPECTEUR, CLIENT):
            user = _login(email)
            assert user.get(reverse('pilotage-indicators')).status_code == 403, email
            assert user.get(reverse('pilotage-indicator-sources', args=['entrees'])).status_code == 403, email
        assert _login(ADV).get(reverse('pilotage-indicator-sources', args=['inconnu'])).status_code == 404


@pytest.mark.django_db
class TestDossierChronology:
    """PO-2026-09-28-67 (P12, P17 en partie)."""

    def _played_dossier(self):
        client, adv, promoter, reservation_id = _reserve_and_examine()
        _fees_paid_directly(promoter, reservation_id)
        builder = _login(CONSTRUCTEUR)
        _promoter, lot = _promoter_lot()
        _milestone, declaration_id = _declare_foundations(builder, promoter, lot)
        assert _deposit(builder, declaration_id, 'plan_implantation').status_code == 201
        mission_id = _assign(adv, promoter, declaration_id)
        assert _opinion(_login(INSPECTEUR), mission_id, outcome='avec_reserve', reserves=[
            {'motif': 'Enrobage insuffisant', 'expected_action': 'Reprendre l’enrobage'},
        ]).status_code == 201
        return adv, reservation_id

    def test_business_and_worksite_events_merged_in_server_order(self):
        adv, reservation_id = self._played_dossier()

        response = adv.get(reverse('dossier-chronology', args=[reservation_id]))

        assert response.status_code == 200, response.data
        entries = response.data['entries']
        actions = [entry['action'] for entry in entries]
        expected = [
            'Réservation demandée', 'Bien bloqué pour le client', 'Dossier examiné', 'Appel de fonds émis',
            'Encaissement enregistré (simulé)', 'Encaissement affecté à un appel de fonds',
            'Encaissement rapproché (simulé)', 'Réservation confirmée : frais encaissés', 'Jalon déclaré',
            'Pièce déposée : Plan d’implantation', 'Contrôle affecté à Bureau de contrôle Démonstration',
            'Avis du contrôleur : avec réserve', 'Réserve ouverte',
        ]
        assert [action for action in actions if action in expected] == expected
        assert [entry['at'] for entry in entries] == sorted(entry['at'] for entry in entries)
        first = entries[0]
        assert (first['actor'], first['role']) == ('Awa Koné', 'Cliente fictive')
        reserve = next(entry for entry in entries if entry['action'] == 'Réserve ouverte')
        assert (reserve['object'], reserve['justification']) == ('Jalon « Fondations »', 'Enrobage insuffisant')
        call = next(entry for entry in entries if entry['action'] == 'Appel de fonds émis')
        assert call['object'].startswith('Frais de réservation — 100')

    def test_no_email_and_no_technical_code(self):
        adv, reservation_id = self._played_dossier()

        body = str(adv.get(reverse('dossier-chronology', args=[reservation_id])).data)

        assert '@' not in body
        for code in ('reservation.', 'receipt.', 'payment_call.', 'work_declaration', 'evidence_upload'):
            assert code not in body

    def test_rights_and_unknown_dossier(self):
        _adv, reservation_id = self._played_dossier()
        for email in (FINANCE, ADMIN, CONSTRUCTEUR, CLIENT):
            assert _login(email).get(reverse('dossier-chronology', args=[reservation_id])).status_code == 403, email
        unknown = '00000000-0000-0000-0000-000000000001'
        assert _login(ADV).get(reverse('dossier-chronology', args=[unknown])).status_code == 404

    def test_a_dossier_outside_the_active_instance_is_not_found(self):
        s = _disbursement_scenario()
        set_rls_context(organization_id=s['promoter'].id)
        reservation_id = Reservation.objects.filter(lot_id=s['lot']['id']).values_list('id', flat=True).first()
        assert s['adv'].get(reverse('dossier-chronology', args=[reservation_id])).status_code == 200
        DemoInstance.objects.create(code='DEMO-CI-TEST-ACTIVE', dataset_version='DEMO-CI-v2')
        assert s['adv'].get(reverse('dossier-chronology', args=[reservation_id])).status_code == 404


@pytest.mark.django_db
class TestAdminJournalBusinessLabels:
    def test_each_event_carries_its_business_label(self):
        _reserve_and_examine()
        rows = _login(ADMIN).get(reverse('admin-journal')).data
        labels = {row['action']: row['action_label'] for row in rows}
        assert labels['reservation.validated'] == 'Dossier examiné'
        assert labels['payment_call.issued'] == 'Appel de fonds émis'
