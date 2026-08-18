from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.services import create_document, create_evidence, create_work_declaration
from apps.inspections.models import InspectionOutcome
from apps.inspections.services import create_inspection
from apps.organizations.models import CountryPack, Membership, Organization, Role
from apps.programs.models import Asset, Lot, Milestone, MilestoneTemplate, Program
from apps.programs.services import instantiate_milestones_for_lot

from conftest import ensure_senegal_milestone_template_seeded

PASSWORD = 'strongpass123'


def _register(email, organization_name, role_code='sponsor'):
    """Même technique que les tickets précédents : enregistrement via l'API
    (JWT réel, nécessaire pour que `OrganizationScopeMiddleware` résolve
    `request.organization`), rôle basculé directement en base.
    """
    client = APIClient()
    client.post(
        reverse('register'),
        {'email': email, 'password': PASSWORD, 'organization_name': organization_name},
        format='json',
    )
    token = client.post(reverse('login'), {'email': email, 'password': PASSWORD}, format='json').data['access']
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    user = User.objects.get(email=email)
    organization = Organization.objects.get(name=organization_name)

    set_rls_context(user_id=user.id, organization_id=organization.id)
    if role_code != 'sponsor':
        role, _ = Role.objects.get_or_create(code=role_code, defaults={'label': role_code.capitalize()})
        Membership.objects.filter(user=user, organization=organization).update(role=role)

    return client, organization, user


def _setup_org_with_lot(email, organization_name, role_code='sponsor', lot_name='Lot 1'):
    ensure_senegal_milestone_template_seeded()
    client, organization, user = _register(email, organization_name, role_code=role_code)
    program = Program.objects.create(organization=organization, name='Programme')
    asset = Asset.objects.create(organization=organization, program=program, name='Bien')
    lot = Lot.objects.create(organization=organization, asset=asset, name=lot_name)
    instantiate_milestones_for_lot(lot)
    return client, organization, user, program, asset, lot


def _register_inspecteur(email, organization_name):
    return _register(email, organization_name, role_code='inspecteur')


def _declare_first_milestone(organization, lot, constructeur):
    milestone = lot.milestones.order_by('order').first()
    return create_work_declaration(organization=organization, milestone=milestone, declared_by=constructeur)


def _declare_and_document_first_milestone(organization, lot, constructeur):
    declaration = _declare_first_milestone(organization, lot, constructeur)
    text_file = SimpleUploadedFile('rapport.txt', b'contenu', content_type='text/plain')
    document = create_document(
        organization=organization, owner=constructeur, uploaded_file=text_file,
        category='rapport_chantier', source='mobile_app_photo',
    )
    evidence = create_evidence(
        organization=organization, work_declaration=declaration, documents=[document], added_by=constructeur,
    )
    return declaration, evidence


@pytest.mark.django_db
class TestExceptionsAreNeverKPIs:
    """Ticket 009 — critère d'acceptation central : l'endpoint Exceptions
    n'expose littéralement AUCUN indicateur agrégé (KPI) — impossible de
    faire "remonter les KPI par défaut" puisqu'aucun champ de ce type
    n'existe dans la réponse, vide ou non.
    """

    KPI_LIKE_KEYS = {'total_lots', 'average_progress', 'kpi', 'kpis', 'summary', 'dashboard'}

    def test_exceptions_response_never_contains_a_kpi_field_when_empty(self):
        client, _organization, _user, _program, _asset, _lot = _setup_org_with_lot(
            'exc-empty@example.com', 'Org Exceptions Empty',
        )

        response = client.get(reverse('build-exceptions'))

        assert response.status_code == 200
        assert set(response.data.keys()) == {
            'lots_en_retard', 'controles_a_planifier', 'capacites_manquantes',
            'reserves_ouvertes', 'documents_manquants',
        }
        assert not (self.KPI_LIKE_KEYS & set(response.data.keys()))

    def test_all_five_categories_are_explicit_empty_lists_not_missing_keys(self):
        client, organization, _user, _program, _asset, lot = _setup_org_with_lot(
            'exc-empty2@example.com', 'Org Exceptions Empty 2',
        )
        # Affecte l'organisation pour que "capacités manquantes" soit
        # également vide — sinon un lot fraîchement créé y apparaît toujours
        # par construction (voir TestCapacitesManquantes), ce qui n'est pas
        # ce que ce test veut vérifier (la FORME de la réponse, pas son
        # contenu).
        client.post(
            reverse('lot-assign-organization', args=[lot.id]),
            {'organization_id': str(organization.id)}, format='json',
        )

        response = client.get(reverse('build-exceptions'))

        for category in [
            'lots_en_retard', 'controles_a_planifier', 'capacites_manquantes',
            'reserves_ouvertes', 'documents_manquants',
        ]:
            assert response.data[category] == [], (
                f'{category} devrait être une liste vide explicite, pas absente ni null'
            )


@pytest.mark.django_db
class TestLotsEnRetard:
    def test_a_lot_with_no_activity_past_the_threshold_is_flagged(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'retard1@example.com', 'Org Retard 1', role_code='constructeur',
        )
        declaration = _declare_first_milestone(organization, lot, user)
        old_date = timezone.now() - timedelta(days=30)
        declaration.created_at = old_date
        declaration.save(update_fields=['created_at'])

        response = client.get(reverse('build-exceptions'))

        lot_ids = [row['lot_id'] for row in response.data['lots_en_retard']]
        assert str(lot.id) in lot_ids

    def test_a_lot_with_recent_activity_is_not_flagged(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'retard2@example.com', 'Org Retard 2', role_code='constructeur',
        )
        _declare_first_milestone(organization, lot, user)

        response = client.get(reverse('build-exceptions'))

        lot_ids = [row['lot_id'] for row in response.data['lots_en_retard']]
        assert str(lot.id) not in lot_ids

    def test_a_lot_with_no_milestones_at_all_is_not_flagged_as_delayed(self):
        # Catégorie différente ("capacités manquantes" au sens choisi pour ce
        # ticket ne couvre pas ce cas non plus) — un lot sans jalon n'a rien
        # dont le "retard" pourrait se mesurer.
        client, organization, user, program, asset, _lot = _setup_org_with_lot(
            'retard3@example.com', 'Org Retard 3', role_code='constructeur',
        )
        empty_lot = Lot.objects.create(organization=organization, asset=asset, name='Lot Sans Jalons')
        # Volontairement PAS d'instantiate_milestones_for_lot.

        response = client.get(reverse('build-exceptions'))

        lot_ids = [row['lot_id'] for row in response.data['lots_en_retard']]
        assert str(empty_lot.id) not in lot_ids


@pytest.mark.django_db
class TestControlesAPlanifier:
    def test_a_declaration_with_no_inspection_anywhere_in_its_chain_is_flagged(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'controle1@example.com', 'Org Controle 1', role_code='constructeur',
        )
        declaration = _declare_first_milestone(organization, lot, user)

        response = client.get(reverse('build-exceptions'))

        declaration_ids = [row['work_declaration_id'] for row in response.data['controles_a_planifier']]
        assert str(declaration.id) in declaration_ids

    def test_a_declaration_already_inspected_directly_is_not_flagged(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'controle2@example.com', 'Org Controle 2', role_code='constructeur',
        )
        declaration = _declare_first_milestone(organization, lot, user)
        inspecteur_client, inspecteur_organization, inspecteur = _register_inspecteur(
            'controle2-inspecteur@example.com', 'Org Controle 2 Inspecteur',
        )
        create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            outcome=InspectionOutcome.CONFORME,
        )

        response = client.get(reverse('build-exceptions'))

        declaration_ids = [row['work_declaration_id'] for row in response.data['controles_a_planifier']]
        assert str(declaration.id) not in declaration_ids

    def test_a_declaration_inspected_via_its_evidence_is_not_flagged(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'controle3@example.com', 'Org Controle 3', role_code='constructeur',
        )
        declaration, evidence = _declare_and_document_first_milestone(organization, lot, user)
        inspecteur_client, inspecteur_organization, inspecteur = _register_inspecteur(
            'controle3-inspecteur@example.com', 'Org Controle 3 Inspecteur',
        )
        create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, evidence_id=evidence.id,
            outcome=InspectionOutcome.CONFORME,
        )

        response = client.get(reverse('build-exceptions'))

        declaration_ids = [row['work_declaration_id'] for row in response.data['controles_a_planifier']]
        assert str(declaration.id) not in declaration_ids


@pytest.mark.django_db
class TestCapacitesManquantes:
    """Ticket 009 — définition explicitement choisie par l'utilisateur :
    un lot sans `assigned_organization` (organisation constructrice
    affectée), pas un problème de jalons ni de disponibilité d'inspecteur.
    """

    def test_a_lot_without_assigned_organization_is_flagged(self):
        client, _organization, _user, _program, _asset, lot = _setup_org_with_lot(
            'capacite1@example.com', 'Org Capacite 1',
        )

        response = client.get(reverse('build-exceptions'))

        lot_ids = [row['lot_id'] for row in response.data['capacites_manquantes']]
        assert str(lot.id) in lot_ids

    def test_a_lot_with_an_assigned_organization_is_not_flagged(self):
        client, organization, _user, _program, _asset, lot = _setup_org_with_lot(
            'capacite2@example.com', 'Org Capacite 2',
        )
        response = client.post(
            reverse('lot-assign-organization', args=[lot.id]),
            {'organization_id': str(organization.id)}, format='json',
        )
        assert response.status_code == 200

        exceptions_response = client.get(reverse('build-exceptions'))

        lot_ids = [row['lot_id'] for row in exceptions_response.data['capacites_manquantes']]
        assert str(lot.id) not in lot_ids


@pytest.mark.django_db
class TestReservesOuvertes:
    def test_an_open_reserve_is_flagged_with_its_trust_event(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'reserve1@example.com', 'Org Reserve 1', role_code='constructeur',
        )
        declaration = _declare_first_milestone(organization, lot, user)
        inspecteur_client, inspecteur_organization, inspecteur = _register_inspecteur(
            'reserve1-inspecteur@example.com', 'Org Reserve 1 Inspecteur',
        )
        create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            outcome=InspectionOutcome.AVEC_RESERVE, note='Fissure',
        )

        response = client.get(reverse('build-exceptions'))

        reserve_rows = response.data['reserves_ouvertes']
        assert len(reserve_rows) == 1
        assert reserve_rows[0]['lot_id'] == str(lot.id)
        assert reserve_rows[0]['status'] == 'ouverte'
        assert reserve_rows[0]['event']['level'] == 'controle'

    def test_open_reserve_row_lists_the_lots_existing_evidence_for_the_correction_form(self):
        # L'action réelle sur cette exception (« Documenter une correction »,
        # POST /api/reserve-corrections/) exige une Evidence EXISTANTE — le
        # frontend a donc besoin de savoir laquelle proposer, sans requête
        # supplémentaire ni logique de sélection dupliquée côté React.
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'reserve3@example.com', 'Org Reserve 3', role_code='constructeur',
        )
        declaration, evidence = _declare_and_document_first_milestone(organization, lot, user)
        inspecteur_client, inspecteur_organization, inspecteur = _register_inspecteur(
            'reserve3-inspecteur@example.com', 'Org Reserve 3 Inspecteur',
        )
        create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, evidence_id=evidence.id,
            outcome=InspectionOutcome.AVEC_RESERVE, note='Fissure',
        )

        response = client.get(reverse('build-exceptions'))

        reserve_row = response.data['reserves_ouvertes'][0]
        evidence_ids = [item['id'] for item in reserve_row['available_evidence']]
        assert str(evidence.id) in evidence_ids

    def test_available_evidence_rows_expose_the_author_to_differentiate_entries(self):
        """Ticket 014 (friction du rapport bout-en-bout) : plusieurs preuves
        du même jalon soumises le même jour étaient strictement
        indiscernables dans le dropdown "Documenter une correction" de
        BUILD (« Foncier — 16/08/2026 » répété 5 fois). L'auteur permet de
        les différencier immédiatement, sans requête supplémentaire.
        """
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'reserve-evidence-author@example.com', 'Org Reserve Evidence Author', role_code='constructeur',
        )
        declaration, evidence = _declare_and_document_first_milestone(organization, lot, user)
        inspecteur_client, inspecteur_organization, inspecteur = _register_inspecteur(
            'reserve-evidence-author-inspecteur@example.com', 'Org Reserve Evidence Author Inspecteur',
        )
        create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, evidence_id=evidence.id,
            outcome=InspectionOutcome.AVEC_RESERVE, note='Fissure',
        )

        response = client.get(reverse('build-exceptions'))

        reserve_row = response.data['reserves_ouvertes'][0]
        evidence_row = next(item for item in reserve_row['available_evidence'] if item['id'] == str(evidence.id))
        assert evidence_row['added_by_email'] == user.email

    def test_a_resolved_reserve_is_not_flagged(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'reserve2@example.com', 'Org Reserve 2', role_code='constructeur',
        )
        declaration = _declare_first_milestone(organization, lot, user)
        inspecteur_client, inspecteur_organization, inspecteur = _register_inspecteur(
            'reserve2-inspecteur@example.com', 'Org Reserve 2 Inspecteur',
        )
        inspection = create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            outcome=InspectionOutcome.AVEC_RESERVE, note='Fissure',
        )
        reserve = inspection.opened_reserve
        create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            outcome=InspectionOutcome.CONFORME, reserve_id=reserve.id,
        )

        response = client.get(reverse('build-exceptions'))

        reserve_ids = [row['reserve_id'] for row in response.data['reserves_ouvertes']]
        assert str(reserve.id) not in reserve_ids

    def test_a_resolved_reserve_is_not_flagged_even_when_its_two_closing_events_share_a_timestamp(self):
        """Ticket 013 bis — reproduit le bug de tri de TrustEvent :
        `_advance_existing_reserve` crée coup sur coup `nouvelle_inspection`
        puis `levee` sur la même réserve, dans la même transaction. Sans
        tie-break (`sequence`), un `created_at` identique entre les deux
        peut faire remonter `nouvelle_inspection` (encore « ouvert ») au
        lieu de l'événement terminal réel — `_bulk_open_reserves`
        continuerait alors à exposer cette réserve comme ouverte.
        """
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'reserve-tiebreak@example.com', 'Org Reserve Tiebreak', role_code='constructeur',
        )
        declaration = _declare_first_milestone(organization, lot, user)
        inspecteur_client, inspecteur_organization, inspecteur = _register_inspecteur(
            'reserve-tiebreak-inspecteur@example.com', 'Org Reserve Tiebreak Inspecteur',
        )
        inspection = create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            outcome=InspectionOutcome.AVEC_RESERVE, note='Fissure',
        )
        reserve = inspection.opened_reserve

        frozen_now = timezone.now()
        with patch('django.utils.timezone.now', return_value=frozen_now):
            create_inspection(
                inspector=inspecteur, inspector_organization=inspecteur_organization,
                target_organization_id=organization.id, work_declaration_id=declaration.id,
                outcome=InspectionOutcome.CONFORME, reserve_id=reserve.id,
            )

        response = client.get(reverse('build-exceptions'))

        reserve_ids = [row['reserve_id'] for row in response.data['reserves_ouvertes']]
        assert str(reserve.id) not in reserve_ids


@pytest.mark.django_db
class TestDocumentsManquants:
    def test_a_declaration_with_no_evidence_is_flagged(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'doc1@example.com', 'Org Doc 1', role_code='constructeur',
        )
        declaration = _declare_first_milestone(organization, lot, user)

        response = client.get(reverse('build-exceptions'))

        declaration_ids = [row['work_declaration_id'] for row in response.data['documents_manquants']]
        assert str(declaration.id) in declaration_ids

    def test_a_declaration_with_evidence_is_not_flagged(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'doc2@example.com', 'Org Doc 2', role_code='constructeur',
        )
        declaration, _evidence = _declare_and_document_first_milestone(organization, lot, user)

        response = client.get(reverse('build-exceptions'))

        declaration_ids = [row['work_declaration_id'] for row in response.data['documents_manquants']]
        assert str(declaration.id) not in declaration_ids


@pytest.mark.django_db
class TestConstructeurCannotChangeReserveStatusFromBuild:
    """Ticket 009 — rappel critique explicite : aucune action de BUILD ne
    doit permettre à un rôle constructeur de modifier directement le statut
    d'une réserve (garde déjà posée au ticket 005 côté backend — ici on
    prouve que BUILD n'ouvre aucune nouvelle porte).
    """

    def test_constructeur_cannot_create_an_inspection_reserve_status_change(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'noguard1@example.com', 'Org No Guard 1', role_code='constructeur',
        )
        declaration = _declare_first_milestone(organization, lot, user)

        # Tentative explicite : le constructeur essaie la SEULE route qui
        # fait progresser une Reserve (voir CLAUDE.md, section Inspections).
        response = client.post(
            reverse('inspection-list'),
            {
                'organization': str(organization.id), 'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
            },
            format='json',
        )

        assert response.status_code == 403

    def test_reserve_viewset_rejects_writes_from_anyone_including_constructeur(self):
        client, organization, user, _program, _asset, lot = _setup_org_with_lot(
            'noguard2@example.com', 'Org No Guard 2', role_code='constructeur',
        )
        declaration = _declare_first_milestone(organization, lot, user)
        inspecteur_client, inspecteur_organization, inspecteur = _register_inspecteur(
            'noguard2-inspecteur@example.com', 'Org No Guard 2 Inspecteur',
        )
        inspection = create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            outcome=InspectionOutcome.AVEC_RESERVE,
        )
        reserve = inspection.opened_reserve

        response = client.patch(
            reverse('reserve-detail', args=[reserve.id]), {'description': 'forgé'}, format='json',
        )

        assert response.status_code == 405


@pytest.mark.django_db
class TestAllLotsSortFilterPaginate:
    def test_default_ordering_is_by_name(self):
        client, organization, _user, _program, asset, _lot = _setup_org_with_lot(
            'sort1@example.com', 'Org Sort 1', lot_name='Lot B',
        )
        Lot.objects.create(organization=organization, asset=asset, name='Lot A')

        response = client.get(reverse('build-lots'))

        names = [row['name'] for row in response.data['results']]
        assert names == sorted(names)

    def test_ordering_by_minus_created_at_is_most_recent_first(self):
        client, organization, _user, _program, asset, lot_first = _setup_org_with_lot(
            'sort2@example.com', 'Org Sort 2', lot_name='Lot Premier',
        )
        lot_second = Lot.objects.create(organization=organization, asset=asset, name='Lot Second')

        response = client.get(reverse('build-lots'), {'ordering': '-created_at'})

        ids = [row['id'] for row in response.data['results']]
        assert ids.index(str(lot_second.id)) < ids.index(str(lot_first.id))

    def test_an_unknown_ordering_field_falls_back_to_name_rather_than_erroring(self):
        client, _organization, _user, _program, _asset, _lot = _setup_org_with_lot(
            'sort3@example.com', 'Org Sort 3',
        )

        response = client.get(reverse('build-lots'), {'ordering': 'not_a_real_field'})

        assert response.status_code == 200

    def test_filter_by_assigned_false_returns_only_unassigned_lots(self):
        client, organization, _user, _program, asset, assigned_lot = _setup_org_with_lot(
            'filter1@example.com', 'Org Filter 1', lot_name='Lot Affecté',
        )
        client.post(
            reverse('lot-assign-organization', args=[assigned_lot.id]),
            {'organization_id': str(organization.id)}, format='json',
        )
        unassigned_lot = Lot.objects.create(organization=organization, asset=asset, name='Lot Non Affecté')

        response = client.get(reverse('build-lots'), {'assigned': 'false'})

        ids = [row['id'] for row in response.data['results']]
        assert str(unassigned_lot.id) in ids
        assert str(assigned_lot.id) not in ids

    def test_search_by_name_substring(self):
        client, organization, _user, _program, asset, _lot = _setup_org_with_lot(
            'search1@example.com', 'Org Search 1', lot_name='Résidence Alpha',
        )
        Lot.objects.create(organization=organization, asset=asset, name='Résidence Beta')

        response = client.get(reverse('build-lots'), {'q': 'Alpha'})

        names = [row['name'] for row in response.data['results']]
        assert names == ['Résidence Alpha']

    def test_pagination_limits_page_size_and_exposes_total_count(self):
        client, organization, _user, _program, asset, _lot = _setup_org_with_lot(
            'page1@example.com', 'Org Page 1',
        )
        for i in range(30):
            Lot.objects.create(organization=organization, asset=asset, name=f'Lot Extra {i:03d}')

        response = client.get(reverse('build-lots'), {'page_size': 10})

        assert response.data['count'] == 31
        assert len(response.data['results']) == 10
        assert response.data['next'] is not None


@pytest.mark.django_db
class TestAllLotsScalesToTwoHundredLots:
    """Ticket 009 — critère d'acceptation : « Le tableau Tous les lots reste
    utilisable (perçu comme rapide) au-delà de 200 lignes. » Vérifié en
    prouvant que le NOMBRE DE REQUÊTES SQL reste borné, indépendant du
    nombre de lots — une assertion sur un temps en millisecondes serait
    flaky (dépend de la machine), le nombre de requêtes ne l'est pas.
    """

    @staticmethod
    def _bulk_create_lots_with_milestones(organization, asset, count):
        senegal = CountryPack.objects.get(code='SN')
        template = MilestoneTemplate.objects.get(country_pack=senegal, is_active=True)
        steps = list(template.steps.order_by('order'))

        lots = [
            Lot(organization=organization, asset=asset, name=f'Lot Volume {i:04d}')
            for i in range(count)
        ]
        Lot.objects.bulk_create(lots)

        milestones = [
            Milestone(
                organization=organization, lot=lot, order=step.order,
                code=step.code, label=step.label, weight=step.weight,
            )
            for lot in lots for step in steps
        ]
        Milestone.objects.bulk_create(milestones)
        return lots

    def test_query_count_for_two_hundred_lots_does_not_scale_with_row_count(self):
        client_small, organization_small, _user_small, _program_small, asset_small, _lot_small = (
            _setup_org_with_lot('perf-small@example.com', 'Org Perf Small')
        )
        self._bulk_create_lots_with_milestones(organization_small, asset_small, 5)

        with CaptureQueriesContext(connection) as small_context:
            response_small = client_small.get(reverse('build-lots'), {'page_size': 100})
        assert response_small.status_code == 200

        client_large, organization_large, _user_large, _program_large, asset_large, _lot_large = (
            _setup_org_with_lot('perf-large@example.com', 'Org Perf Large')
        )
        self._bulk_create_lots_with_milestones(organization_large, asset_large, 200)

        with CaptureQueriesContext(connection) as large_context:
            response_large = client_large.get(reverse('build-lots'), {'page_size': 100})
        assert response_large.status_code == 200
        # +1 pour le lot déjà créé par _setup_org_with_lot elle-même.
        assert response_large.data['count'] == 201

        small_query_count = len(small_context.captured_queries)
        large_query_count = len(large_context.captured_queries)
        assert large_query_count <= small_query_count + 5, (
            f'Le nombre de requêtes croît avec le nombre de lots '
            f'({small_query_count} pour ~6 lots, {large_query_count} pour 201) — '
            'signe d\'un N+1 caché.'
        )

    def test_exceptions_endpoint_query_count_also_stays_bounded_at_two_hundred_lots(self):
        client, organization, _user, _program, asset, _lot = _setup_org_with_lot(
            'perf-exceptions@example.com', 'Org Perf Exceptions',
        )
        self._bulk_create_lots_with_milestones(organization, asset, 200)

        with CaptureQueriesContext(connection) as context:
            response = client.get(reverse('build-exceptions'))

        assert response.status_code == 200
        # Borne large mais fixe (pas proportionnelle à 200) — seul le nombre
        # de CATÉGORIES d'exceptions doit influencer le compte de requêtes,
        # jamais le nombre de lots.
        assert len(context.captured_queries) < 30, (
            f'{len(context.captured_queries)} requêtes pour 200 lots — probable N+1.'
        )
