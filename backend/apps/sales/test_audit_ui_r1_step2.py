"""Audit UI R1 — étape 2 (P1) : tests côté serveur.

Chaque classe cite le constat de l'audit, la décision du Product Owner et,
quand il existe, le test CDC R1 (T01–T20) lié.
"""
import pytest
from django.test import override_settings
from django.urls import reverse

from apps.accounts.models import User
from apps.organizations.models import Organization
from apps.programs.models import Lot

from .management.commands.seed_demo_scenario import PROMOTER_ORG
from .test_audit_ui_r1 import (
    ADV, CONSTRUCTEUR, FINANCE, INSPECTEUR, _declared_foundations, _login, _opinion, _promoter_lot, _seed,
)

CLIENT = 'client1.demo@keya.test'


def _reserve_and_examine(lot_name='Lot A1'):
    """Awa réserve un lot ; le gestionnaire examine le dossier (appel des frais)."""
    _seed()
    promoter, _lot = _promoter_lot()
    lot = Lot.objects.get(organization=promoter, name=lot_name)
    client = _login(CLIENT)
    reservation = client.post(reverse('reservation-create'), {'lot': str(lot.id), 'organization': str(promoter.id)}, format='json')
    assert reservation.status_code == 201, reservation.data
    adv = _login(ADV)
    examined = adv.post(
        reverse('reservation-validate', args=[reservation.data['id']]) + f'?organization_id={promoter.id}', format='json',
    )
    assert examined.status_code == 200, examined.data
    return client, adv, promoter, reservation.data['id']


def _signal_fees(client, reservation_id, reference='VIR-AWA-0001'):
    calls = client.get(reverse('my-payment-calls', args=[reservation_id])).data
    fees = next(call for call in calls if call['kind'] == 'frais')
    notice = client.post(
        reverse('my-payment-notice-create', args=[fees['id']]), {'client_reference': reference, 'paid_on': '2026-09-28'},
        format='json',
    )
    assert notice.status_code == 201, notice.data
    return notice.data


@pytest.mark.django_db
class TestPO16AccountsAreFinanceOnly:
    """PO-2026-09-27-16 (CDC §4, séparation des fonctions) : « Comptes &
    décaissements » réservé à Finance, refusé au gestionnaire par le serveur."""

    def test_the_manager_is_refused_the_programme_accounts(self):
        _seed()
        promoter, lot = _promoter_lot()
        program_id = str(lot.asset.program_id)
        adv = _login(ADV)
        assert adv.get(reverse('finance-account-list')).status_code == 403
        assert adv.get(reverse('finance-program-account', args=[program_id]) + f'?organization_id={promoter.id}').status_code == 403

    def test_finance_reads_them(self):
        _seed()
        promoter, lot = _promoter_lot()
        program_id = str(lot.asset.program_id)  # lu avant les requêtes (contexte RLS de la connexion)
        finance = _login(FINANCE)
        assert finance.get(reverse('finance-account-list')).status_code == 200
        account = finance.get(reverse('finance-program-account', args=[program_id]) + f'?organization_id={promoter.id}')
        assert account.status_code == 200
        # D04 : le jeu DEMO-CI-v1 prévoit 2 jalons par bien (CDC §9.1), jamais 8.
        lots = {row['lot']['name'] for row in account.data['milestones']}
        assert len(account.data['milestones']) == 2 * len(lots)


@pytest.mark.django_db
class TestR03FinanceReadsCallsAndReceiptsOnly:
    """R03 (PO-2026-09-27-10) : Finance lit les appels et encaissements par
    dossier ; aucune gestion des dossiers, réservations ou contrats."""

    def test_finance_reads_but_never_manages_the_file(self):
        client, _adv, promoter, reservation_id = _reserve_and_examine()
        finance = _login(FINANCE)
        query = f'?organization_id={promoter.id}'
        assert finance.get(reverse('reservation-admin-list')).status_code == 200
        assert finance.get(reverse('payment-call-team', args=[reservation_id]) + query).status_code == 200
        assert finance.post(reverse('reservation-validate', args=[reservation_id]) + query).status_code == 403
        assert finance.post(
            reverse('reservation-admin-cancel', args=[reservation_id]) + query, {'reason': 'x'}, format='json',
        ).status_code == 403
        assert finance.get(reverse('contract-admin-list-create', args=[reservation_id]) + query).status_code == 403
        assert finance.post(
            reverse('payment-call-team', args=[reservation_id]) + query, {'kind': 'frais', 'tier_code': ''}, format='json',
        ).status_code == 403


@pytest.mark.django_db
class TestR04DeferredModulesAreHidden:
    """R04 (PO-2026-09-27-03) : Devis / Appels d'offres, Demandes de programme
    et Tarifs masqués par un réglage ; le code reste, les routes répondent 404."""

    ROUTES = [
        ('pricing-config-current', 'get', 'admin.demo@keya.test'),
        ('pricing-config-history', 'get', 'admin.demo@keya.test'),
        ('procurement-admin-lot-search', 'get', 'admin.demo@keya.test'),
        ('program-request-list-create', 'get', ADV),
        ('program-request-mine', 'get', CLIENT),
        ('procurement-my-candidatures', 'get', CONSTRUCTEUR),
    ]

    def test_deferred_routes_answer_404_when_the_setting_is_off(self):
        _seed()
        with override_settings(KEYA_DEFERRED_MODULES_ENABLED=False):
            for name, method, email in self.ROUTES:
                response = getattr(_login(email), method)(reverse(name))
                assert response.status_code == 404, (name, response.status_code)

    def test_reference_data_of_the_country_pack_stays_available(self):
        _seed()
        with override_settings(KEYA_DEFERRED_MODULES_ENABLED=False):
            admin = _login('admin.demo@keya.test')
            response = admin.get(reverse('legal-payment-tier-template-history') + '?country_pack=CI')
            assert response.status_code != 404

    def test_the_setting_is_off_by_default(self):
        from django.conf import settings as project_settings
        from decouple import config

        assert config('KEYA_DEFERRED_MODULES_ENABLED', default=False, cast=bool) is False
        assert hasattr(project_settings, 'KEYA_DEFERRED_MODULES_ENABLED')


@pytest.mark.django_db
class TestC03C04C06PaymentSchedule:
    """C03, C04, C06 : échéancier fictif du contrat (barème Country Pack CI,
    CDC §9.1) : premier versement 3 000 000 frais inclus, jamais déduits deux
    fois, puis un palier par jalon, avec sa condition réelle."""

    def test_the_client_receives_the_contract_schedule(self):
        client, _adv, _promoter, reservation_id = _reserve_and_examine()
        reservation = next(row for row in client.get(reverse('my-reservations')).data if row['id'] == reservation_id)
        schedule = reservation['payment_schedule']
        assert schedule['country_pack'] == 'CI'
        assert schedule['first_payment_amount'] == '3000000'
        rows = schedule['rows']
        assert [row['code'] for row in rows] == ['reservation', 'fondations', 'elevation']
        assert rows[0]['fee_included'] == '100000'
        assert [row['amount'] for row in rows] == ['3000000', '12000000', '15000000']
        assert sum(int(row['amount']) for row in rows) == 30000000
        assert 'acceptation technique' in rows[1]['condition']


@pytest.mark.django_db
class TestPO18PlannedDatesAndManagerIssuedCalls:
    """PO-2026-09-27-18 (C06, CDC §8.1) : dates prévisionnelles fictives dans
    l'échéancier ; chaque appel est émis par le gestionnaire, jamais
    déclenché par une acceptation technique."""

    def test_each_row_carries_a_fictitious_planned_date_after_the_reservation(self):
        from datetime import date

        client, _adv, _promoter, reservation_id = _reserve_and_examine()
        reservation = next(row for row in client.get(reverse('my-reservations')).data if row['id'] == reservation_id)
        rows = reservation['payment_schedule']['rows']
        planned = [date.fromisoformat(row['planned_on']) for row in rows]
        assert planned == sorted(planned)
        assert (planned[1] - planned[0]).days == 90
        assert 'émis par le gestionnaire' in rows[1]['condition']

    def test_a_technical_acceptance_never_creates_a_client_call(self):
        from apps.sales.models import PaymentCall

        # PO-2026-09-29-09 : le client réserve avant le chantier ; son
        # dossier est concrétisé avant la déclaration.
        _builder, promoter, _milestone, _declaration_id, _evidence_id, _doc, mission_id = _declared_foundations(
            client_email=CLIENT,
        )
        from apps.core.rls import set_rls_context

        set_rls_context(organization_id=promoter.id)
        before = PaymentCall.objects.count()
        assert _opinion(_login(INSPECTEUR), mission_id, outcome='conforme').status_code == 201
        set_rls_context(organization_id=promoter.id)
        assert PaymentCall.objects.count() == before


@pytest.mark.django_db
class TestF01F02SignalledTransferAndReceipt:
    """F01, F02 (PO-2026-09-27-05, T12) : le signalement du client n'est
    qu'un avis ; Finance enregistre l'encaissement avec une référence
    bancaire simulée distincte ; état « Rapproché (simulé) », affectations
    et montant non affecté visibles."""

    def test_the_bank_reference_is_required_and_distinct_from_the_client_one(self):
        client, _adv, promoter, reservation_id = _reserve_and_examine()
        notice = _signal_fees(client, reservation_id)
        finance = _login(FINANCE)
        url = reverse('finance-payment-notice-confirm', args=[notice['id']]) + f'?organization_id={promoter.id}'
        assert finance.post(url, {}, format='json').status_code == 400
        # Adapté selon PO-2026-09-28-10 : montant reçu fourni (lu au relevé).
        same = finance.post(url, {'bank_reference': 'VIR-AWA-0001', 'amount': '100000'}, format='json')
        assert same.status_code == 409
        assert 'distincte' in same.data['detail']

    def test_a_processed_signal_shows_the_reconciled_receipt_its_allocation_and_the_unallocated_excess(self):
        client, _adv, promoter, reservation_id = _reserve_and_examine()
        notice = _signal_fees(client, reservation_id)
        assert notice['status_label'] == 'Signalé par le client — non encaissé'
        finance = _login(FINANCE)
        response = finance.post(
            reverse('finance-payment-notice-confirm', args=[notice['id']]) + f'?organization_id={promoter.id}',
            {'bank_reference': 'SIM-ENC-0001', 'amount': '150000'}, format='json',
        )
        assert response.status_code == 200, response.data
        assert response.data['status_label'] == 'Traité — encaissement enregistré'
        receipt = response.data['receipt']
        assert receipt['bank_reference'] == 'SIM-ENC-0001'
        assert receipt['status_label'] == 'Rapproché (simulé)'
        assert [allocation['amount'] for allocation in receipt['allocations']] == ['100000.00']
        assert receipt['unallocated_amount'] == '50000.00'
        listed = finance.get(reverse('finance-payment-notice-list') + '?status=').data
        assert next(row for row in listed if row['id'] == notice['id'])['receipt']['unallocated_amount'] == '50000.00'


@pytest.mark.django_db
class TestD03NoDuplicatePendingMission:
    """D03 : jamais deux missions en attente sur la même déclaration ; un
    recontrôle s'affecte après l'avis."""

    def test_a_second_pending_mission_is_refused_then_allowed_after_the_opinion(self):
        _builder, promoter, _milestone, declaration_id, _evidence_id, _doc, mission_id = _declared_foundations()
        adv = _login(ADV)
        inspector_user = User.objects.get(email=INSPECTEUR)
        payload = {'organization': str(promoter.id), 'work_declaration': declaration_id, 'assigned_inspector': str(inspector_user.id)}
        duplicate = adv.post(reverse('backoffice-mission-create'), payload, format='json')
        assert duplicate.status_code == 400
        assert 'déjà en attente' in str(duplicate.data)

        inspector = _login(INSPECTEUR)
        opinion = _opinion(inspector, mission_id, outcome='avec_reserve', reserves=[
            {'motif': 'Enrobage insuffisant', 'expected_action': 'Reprendre et fournir une photo'},
        ])
        assert opinion.status_code == 201, opinion.data
        assert adv.post(reverse('backoffice-mission-create'), payload, format='json').status_code == 201


@pytest.mark.django_db
class TestK05CompletedMissionShowsItsOutcome:
    """K05 : une mission terminée montre le résultat de l'avis et ses
    réserves ; D03 : chaque mission porte sa date d'affectation."""

    def test_the_mission_list_carries_the_outcome_and_the_assignment_date(self):
        _builder, _promoter, _milestone, _declaration_id, _evidence_id, _doc, mission_id = _declared_foundations()
        inspector = _login(INSPECTEUR)
        assert _opinion(inspector, mission_id, outcome='avec_reserve', reserves=[
            {'motif': 'Enrobage insuffisant', 'expected_action': 'Reprendre et fournir une photo'},
            {'motif': 'Réservation manquante', 'expected_action': 'Poser la réservation'},
        ]).status_code == 201
        row = next(m for m in inspector.get(reverse('control-mission-list')).data if m['id'] == mission_id)
        assert row['completed'] is True
        assert row['assigned_at']
        assert row['outcome']['outcome'] == 'avec_reserve'
        assert row['outcome']['reserves_opened'] == 2
        assert row['outcome']['reserves_lifted'] == 0


@pytest.mark.django_db
class TestPO13NoPromoterWording:
    """PO-2026-09-27-13 : le terme « promoteur » disparaît de la plateforme."""

    def test_the_seeded_builder_organisation_is_never_called_promoteur(self):
        _seed()
        assert 'promoteur' not in PROMOTER_ORG.lower()
        assert not Organization.objects.filter(name__icontains='promoteur').exists()

    def test_a_legacy_base_is_renamed_never_duplicated(self):
        _seed()
        Organization.objects.filter(name=PROMOTER_ORG).update(name='Promoteur-constructeur Démonstration Abidjan')
        _seed()
        assert Organization.objects.filter(name=PROMOTER_ORG).count() == 1
        assert not Organization.objects.filter(name__icontains='promoteur').exists()

    def test_the_public_offer_names_the_builder(self):
        _seed()
        from rest_framework.test import APIClient

        offer = APIClient().get(reverse('public-offer')).data
        program = offer[0] if isinstance(offer, list) else offer['programs'][0]
        assert 'promoter' not in program
        assert program['constructeur'] == PROMOTER_ORG
