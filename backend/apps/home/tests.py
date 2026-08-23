from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.services import create_document, create_evidence, create_work_declaration
from apps.home.services import compute_milestone_status, get_latest_notable_event
from apps.inspections.models import InspectionOutcome
from apps.inspections.services import create_inspection, get_reserve_status
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import Asset, Lot, LotClient, Program
from apps.programs.services import instantiate_milestones_for_lot
from apps.trust import repository as trust_repository
from apps.trust.models import TrustLevel

PASSWORD = 'strongpass123'


def _register(email, organization_name, role_code='sponsor'):
    """Même technique que les tickets précédents : enregistrement via l'API
    (JWT réel, nécessaire pour que `OrganizationScopeMiddleware` résolve
    `request.organization`), rôle basculé directement en base (pas
    d'endpoint d'invitation, ticket 001 hors scope).
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


def _setup_constructeur_lot(email, organization_name, location='Dakar, Sénégal'):
    client, organization, user = _register(email, organization_name, role_code='constructeur')
    program = Program.objects.create(organization=organization, name='Programme Keur Massar')
    asset = Asset.objects.create(
        organization=organization, program=program, name='Résidence Ker', location=location,
    )
    lot = Lot.objects.create(organization=organization, asset=asset, name='Lot 12')
    instantiate_milestones_for_lot(lot)
    return client, organization, user, asset, lot


def _assign_client_to_lot(email, organization, lot):
    """Ajoute un client à une organisation EXISTANTE et l'assigne au lot —
    `_register` ne convient pas ici : `POST /register` crée toujours une
    NOUVELLE organisation (bootstrap, ticket 001), donc appeler `_register`
    deux fois avec le même nom d'organisation créerait deux lignes
    `Organization` distinctes portant le même nom, pas un second membre de la
    même organisation. Même technique que
    `apps/evidence/tests.py::_add_org_member` : création directe en base
    (pas d'endpoint d'invitation, ticket 001 hors scope).
    """
    client_user = User.objects.create_user(email=email, password=PASSWORD)
    role, _ = Role.objects.get_or_create(code='client', defaults={'label': 'Client'})
    set_rls_context(user_id=client_user.id, organization_id=organization.id)
    Membership.objects.create(user=client_user, organization=organization, role=role)
    LotClient.objects.create(organization=organization, lot=lot, client=client_user)

    client = APIClient()
    token = client.post(reverse('login'), {'email': email, 'password': PASSWORD}, format='json').data['access']
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
    return client, client_user


def _declare_and_document_first_milestone(organization, lot, constructeur):
    milestone = lot.milestones.order_by('order').first()
    declaration = create_work_declaration(organization=organization, milestone=milestone, declared_by=constructeur)

    text_file = SimpleUploadedFile('rapport.txt', b'contenu du rapport', content_type='text/plain')
    document = create_document(
        organization=organization, owner=constructeur, uploaded_file=text_file,
        category='rapport_chantier', source='mobile_app_photo',
    )
    evidence = create_evidence(
        organization=organization, work_declaration=declaration, documents=[document], added_by=constructeur,
    )
    return milestone, declaration, evidence


def _register_inspecteur(email, organization_name):
    return _register(email, organization_name, role_code='inspecteur')


@pytest.mark.django_db
class TestClientNeverSeesAnotherLotsData:
    """Ticket 008 — critère de sécurité central, vérifié par une tentative
    explicite (pas par la simple absence de lien dans l'UI, instruction
    explicite du ticket).
    """

    def _two_lots_two_clients_same_org(self):
        constructeur_client, organization, constructeur, asset, lot_a = _setup_constructeur_lot(
            'home-constructeur-a@example.com', 'Org Home Sécurité',
        )
        client_a, client_user_a = _assign_client_to_lot(
            'home-client-a@example.com', organization, lot_a,
        )

        lot_b = Lot.objects.create(organization=organization, asset=asset, name='Lot 13')
        instantiate_milestones_for_lot(lot_b)
        client_b, client_user_b = _assign_client_to_lot(
            'home-client-b@example.com', organization, lot_b,
        )

        return client_a, client_b, lot_a, lot_b

    def test_overview_of_a_lot_assigned_to_a_different_client_in_the_same_org_returns_404(self):
        client_a, _client_b, _lot_a, lot_b = self._two_lots_two_clients_same_org()

        response = client_a.get(reverse('my-lot-overview', args=[lot_b.id]))

        assert response.status_code == 404

    def test_evidence_feed_of_a_lot_assigned_to_a_different_client_in_the_same_org_returns_404(self):
        client_a, _client_b, _lot_a, lot_b = self._two_lots_two_clients_same_org()

        response = client_a.get(reverse('my-lot-evidence', args=[lot_b.id]))

        assert response.status_code == 404

    def test_overview_of_a_lot_in_a_completely_different_organization_returns_404(self):
        _constructeur_client, _organization, _constructeur, _asset, lot_other_org = _setup_constructeur_lot(
            'home-constructeur-other@example.com', 'Org Home Autre',
        )
        _constructeur_client_a, organization_a, _constructeur_a, _asset_a, lot_a = _setup_constructeur_lot(
            'home-constructeur-a2@example.com', 'Org Home A2',
        )
        client_a, _client_user_a = _assign_client_to_lot(
            'home-client-a2@example.com', organization_a, lot_a,
        )

        response = client_a.get(reverse('my-lot-overview', args=[lot_other_org.id]))

        assert response.status_code == 404

    def test_my_lots_list_never_includes_a_lot_assigned_to_someone_else(self):
        client_a, client_b, lot_a, lot_b = self._two_lots_two_clients_same_org()

        response_a = client_a.get(reverse('my-lots'))
        ids_a = [row['id'] for row in response_a.data]
        assert str(lot_a.id) in ids_a
        assert str(lot_b.id) not in ids_a

        response_b = client_b.get(reverse('my-lots'))
        ids_b = [row['id'] for row in response_b.data]
        assert str(lot_b.id) in ids_b
        assert str(lot_a.id) not in ids_b

    def test_a_user_with_no_lot_assignment_gets_an_empty_list_not_an_error(self):
        client, _organization, _user = _register('home-no-lot@example.com', 'Org Home Sans Lot', role_code='client')

        response = client.get(reverse('my-lots'))

        assert response.status_code == 200
        assert response.data == []


@pytest.mark.django_db
class TestProgressionIsComputedServerSideNotInFrontend:
    """Ticket 008 — critère d'acceptation : toute donnée affichée (ici, la
    progression) provient d'un endpoint qui a déjà tranché. On le prouve en
    vérifiant que le pourcentage renvoyé change RÉELLEMENT quand l'état
    sous-jacent change, avec une valeur exacte (pas seulement "supérieur à
    0") — ce qui prouve un calcul réel côté serveur, pas une valeur figée.
    """

    def test_progress_percentage_is_zero_before_any_declaration(self):
        constructeur_client, organization, constructeur, asset, lot = _setup_constructeur_lot(
            'home-progress-constructeur1@example.com', 'Org Home Progression 1',
        )
        client, _client_user = _assign_client_to_lot('home-progress-client1@example.com', organization, lot)

        response = client.get(reverse('my-lot-overview', args=[lot.id]))

        assert response.status_code == 200
        assert response.data['progress_percentage'] == 0
        assert all(m['level'] is None for m in response.data['milestones'])

    def test_progress_percentage_reflects_exactly_one_documented_milestone_among_eight(self):
        constructeur_client, organization, constructeur, asset, lot = _setup_constructeur_lot(
            'home-progress-constructeur2@example.com', 'Org Home Progression 2',
        )
        client, _client_user = _assign_client_to_lot('home-progress-client2@example.com', organization, lot)

        total_milestones = lot.milestones.count()
        assert total_milestones > 1, 'Le template Sénégal doit avoir plusieurs jalons pour ce test.'

        milestone, _declaration, _evidence = _declare_and_document_first_milestone(organization, lot, constructeur)

        response = client.get(reverse('my-lot-overview', args=[lot.id]))

        # Formule documentée dans apps/home/services.py::LEVEL_PROGRESS_FRACTION :
        # 'documente' = 40, un seul jalon documenté sur `total_milestones`.
        expected_percentage = round(40 / total_milestones)
        assert response.data['progress_percentage'] == expected_percentage

        milestone_row = next(m for m in response.data['milestones'] if m['id'] == str(milestone.id))
        assert milestone_row['level'] == 'documente'
        other_rows = [m for m in response.data['milestones'] if m['id'] != str(milestone.id)]
        assert all(m['level'] is None for m in other_rows)


@pytest.mark.django_db
class TestLotOverviewContent:
    """Ticket 008 — Vue d'ensemble : hero du bien + dernier événement
    notable, au format `TrustEvent` (repository.get_current_status).
    """

    def test_overview_contains_hero_fields(self):
        constructeur_client, organization, constructeur, asset, lot = _setup_constructeur_lot(
            'home-hero-constructeur@example.com', 'Org Home Hero', location='Almadies, Dakar',
        )
        client, _client_user = _assign_client_to_lot('home-hero-client@example.com', organization, lot)

        response = client.get(reverse('my-lot-overview', args=[lot.id]))

        assert response.status_code == 200
        assert response.data['lot_name'] == 'Lot 12'
        assert response.data['asset_name'] == 'Résidence Ker'
        assert response.data['asset_location'] == 'Almadies, Dakar'
        assert response.data['program_name'] == 'Programme Keur Massar'

    def test_latest_notable_event_matches_the_most_recent_trust_event_of_the_lot(self):
        constructeur_client, organization, constructeur, asset, lot = _setup_constructeur_lot(
            'home-event-constructeur@example.com', 'Org Home Event',
        )
        client, _client_user = _assign_client_to_lot('home-event-client@example.com', organization, lot)

        _milestone, _declaration, _evidence = _declare_and_document_first_milestone(organization, lot, constructeur)

        response = client.get(reverse('my-lot-overview', args=[lot.id]))

        event = response.data['latest_notable_event']
        assert event is not None
        assert event['level'] == 'documente'
        assert event['source'] == 'evidence_upload'
        assert event['actor'] == constructeur.email

    def test_overview_of_a_lot_with_no_activity_yet_has_no_latest_event(self):
        constructeur_client, organization, constructeur, asset, lot = _setup_constructeur_lot(
            'home-noevent-constructeur@example.com', 'Org Home No Event',
        )
        client, _client_user = _assign_client_to_lot('home-noevent-client@example.com', organization, lot)

        response = client.get(reverse('my-lot-overview', args=[lot.id]))

        assert response.data['latest_notable_event'] is None
        assert response.data['open_reserve'] is None


@pytest.mark.django_db
class TestTrustEventOrderingTieBreak:
    """Ticket 013 bis — `compute_milestone_status`/`get_latest_notable_event`
    lisent `TrustEvent` directement (pas via `apps.trust.repository`), donc
    ne bénéficiaient pas du tie-break `sequence` ajouté au ticket 013 bis.
    Reproduit le même défaut de tri (`-created_at` seul) que celui trouvé
    dans `apps.build.services._bulk_open_reserves` : deux `TrustEvent`
    créés avec un `created_at` identique doivent quand même être départagés
    par leur ordre d'insertion réel (`sequence`), jamais par un ordre
    arbitraire côté Postgres.
    """

    def test_compute_milestone_status_breaks_a_created_at_tie_by_insertion_order(self):
        constructeur_client, organization, constructeur, asset, lot = _setup_constructeur_lot(
            'home-tiebreak-milestone-constructeur@example.com', 'Org Home Tiebreak Milestone',
        )
        milestone = lot.milestones.order_by('order').first()
        declaration = create_work_declaration(
            organization=organization, milestone=milestone, declared_by=constructeur,
        )

        frozen_now = timezone.now()
        with patch('django.utils.timezone.now', return_value=frozen_now):
            trust_repository.create(
                subject=declaration, organization=organization, level=TrustLevel.CONTROLE,
                actor=constructeur, source='tiebreak_first',
            )
            latest = trust_repository.create(
                subject=declaration, organization=organization, level=TrustLevel.VERIFIE,
                actor=constructeur, source='tiebreak_second',
            )

        status = compute_milestone_status(milestone)

        assert status.id == latest.id

    def test_get_latest_notable_event_breaks_a_created_at_tie_by_insertion_order(self):
        constructeur_client, organization, constructeur, asset, lot = _setup_constructeur_lot(
            'home-tiebreak-lot-constructeur@example.com', 'Org Home Tiebreak Lot',
        )
        milestone = lot.milestones.order_by('order').first()
        declaration = create_work_declaration(
            organization=organization, milestone=milestone, declared_by=constructeur,
        )

        frozen_now = timezone.now()
        with patch('django.utils.timezone.now', return_value=frozen_now):
            trust_repository.create(
                subject=declaration, organization=organization, level=TrustLevel.CONTROLE,
                actor=constructeur, source='tiebreak_first',
            )
            latest = trust_repository.create(
                subject=declaration, organization=organization, level=TrustLevel.VERIFIE,
                actor=constructeur, source='tiebreak_second',
            )

        event = get_latest_notable_event(lot)

        assert event.id == latest.id


@pytest.mark.django_db
class TestOpenReserveSurfacesAsMainProblem:
    """Ticket 008 — objectif produit (V3.0 §26.1) : le client identifie « le
    problème principal ». Une réserve ouverte non résolue est ce problème.
    """

    def _build_lot_with_open_reserve(self, suffix):
        constructeur_client, organization, constructeur, asset, lot = _setup_constructeur_lot(
            f'home-reserve-constructeur-{suffix}@example.com', f'Org Home Reserve {suffix}',
        )
        client, _client_user = _assign_client_to_lot(
            f'home-reserve-client-{suffix}@example.com', organization, lot,
        )
        _milestone, declaration, _evidence = _declare_and_document_first_milestone(organization, lot, constructeur)

        inspecteur_client, inspecteur_organization, inspecteur = _register_inspecteur(
            f'home-reserve-inspecteur-{suffix}@example.com', f'Org Home Reserve Inspecteur {suffix}',
        )
        inspection = create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            outcome=InspectionOutcome.AVEC_RESERVE, note='Fissure visible',
        )
        reserve = inspection.opened_reserve
        return client, organization, lot, inspecteur, inspecteur_organization, reserve

    def test_an_open_reserve_appears_as_the_main_problem_in_the_overview(self):
        client, _organization, lot, _inspecteur, _inspecteur_org, reserve = self._build_lot_with_open_reserve('a')

        response = client.get(reverse('my-lot-overview', args=[lot.id]))

        assert response.data['open_reserve'] is not None
        assert response.data['open_reserve']['id'] == str(reserve.id)
        assert response.data['open_reserve']['status'] == 'ouverte'

    def test_a_resolved_reserve_no_longer_appears_as_the_open_problem(self):
        client, organization, lot, inspecteur, inspecteur_organization, reserve = self._build_lot_with_open_reserve('b')
        # `create_inspection` restaure le contexte RLS de l'inspecteur en
        # sortie (voir apps/inspections/services.py, bloc `finally`) — il
        # faut reposer explicitement le contexte de l'organisation du lot
        # avant toute lecture directe hors API, sinon la policy RLS de
        # trust_event masque l'événement qu'on vient pourtant de créer.
        set_rls_context(organization_id=organization.id)
        assert get_reserve_status(reserve) == 'ouverte'

        # Une inspection de suivi conforme lève la réserve (voir
        # apps.inspections.services._advance_existing_reserve) — rattachée à
        # la déclaration d'origine, comme une vraie ré-inspection.
        declaration = reserve.opened_by_inspection.work_declaration
        create_inspection(
            inspector=inspecteur, inspector_organization=inspecteur_organization,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            outcome=InspectionOutcome.CONFORME, reserve_id=reserve.id,
        )

        response = client.get(reverse('my-lot-overview', args=[lot.id]))

        assert response.data['open_reserve'] is None


@pytest.mark.django_db
class TestEvidenceFeed:
    """Ticket 008 — Vue « Avancement & preuves » : liste chronologique des
    `Evidence` avec statut (format `StatusBadge`) et provenance.
    """

    def test_evidence_feed_is_chronological_most_recent_first_with_status_and_provenance(self):
        constructeur_client, organization, constructeur, asset, lot = _setup_constructeur_lot(
            'home-feed-constructeur@example.com', 'Org Home Feed',
        )
        client, _client_user = _assign_client_to_lot('home-feed-client@example.com', organization, lot)

        milestones = list(lot.milestones.order_by('order'))
        first_milestone, second_milestone = milestones[0], milestones[1]

        declaration_1 = create_work_declaration(
            organization=organization, milestone=first_milestone, declared_by=constructeur,
        )
        document_1 = create_document(
            organization=organization, owner=constructeur,
            uploaded_file=SimpleUploadedFile('un.txt', b'un', content_type='text/plain'),
            category='photo', source='mobile_app_photo',
        )
        evidence_1 = create_evidence(
            organization=organization, work_declaration=declaration_1, documents=[document_1], added_by=constructeur,
        )

        declaration_2 = create_work_declaration(
            organization=organization, milestone=second_milestone, declared_by=constructeur,
        )
        document_2 = create_document(
            organization=organization, owner=constructeur,
            uploaded_file=SimpleUploadedFile('deux.txt', b'deux', content_type='text/plain'),
            category='photo', source='document_upload',
        )
        evidence_2 = create_evidence(
            organization=organization, work_declaration=declaration_2, documents=[document_2], added_by=constructeur,
        )

        response = client.get(reverse('my-lot-evidence', args=[lot.id]))

        assert response.status_code == 200
        ids_in_order = [row['id'] for row in response.data]
        assert ids_in_order == [str(evidence_2.id), str(evidence_1.id)], (
            'La liste doit être chronologique, la plus récente en premier.'
        )

        first_row = response.data[0]
        assert first_row['status']['level'] == 'documente'
        assert first_row['status']['source'] == 'evidence_upload'
        assert first_row['milestone_code'] == second_milestone.code
        assert first_row['documents'][0]['source'] == 'document_upload'

    def test_evidence_feed_of_a_lot_with_no_evidence_yet_is_an_empty_list(self):
        constructeur_client, organization, constructeur, asset, lot = _setup_constructeur_lot(
            'home-empty-feed-constructeur@example.com', 'Org Home Empty Feed',
        )
        client, _client_user = _assign_client_to_lot('home-empty-feed-client@example.com', organization, lot)

        response = client.get(reverse('my-lot-evidence', args=[lot.id]))

        assert response.status_code == 200
        assert response.data == []


@pytest.mark.django_db
class TestClientCanOpenALitige:
    """Ticket B-041 — première action d'écriture jamais exposée depuis HOME
    (jusqu'ici strictement lecture seule, ticket 008), brèche délibérée et
    étroite : seulement « ouvrir un litige sur MON lot ».
    """

    def test_client_opens_a_litige_on_their_own_lot(self):
        _constructeur_client, organization, _constructeur, _asset, lot = _setup_constructeur_lot(
            'litige-open-constructeur@example.com', 'Org Litige Open',
        )
        client, client_user = _assign_client_to_lot('litige-open-client@example.com', organization, lot)

        response = client.post(
            reverse('my-lot-litiges', args=[lot.id]),
            {'description': "Le chantier n'avance plus depuis 3 semaines, aucune nouvelle du constructeur."},
            format='json',
        )

        assert response.status_code == 201
        assert response.data['status'] == 'ouvert'
        assert str(response.data['lot']) == str(lot.id)
        assert response.data['opened_by_email'] == client_user.email
        assert response.data['resolved_at'] is None

    def test_client_cannot_open_a_litige_on_a_lot_not_assigned_to_them(self):
        _constructeur_client, organization, _constructeur, _asset, lot = _setup_constructeur_lot(
            'litige-forbidden-constructeur@example.com', 'Org Litige Forbidden',
        )
        # Un second client de la MÊME organisation, mais SANS LotClient sur ce lot.
        other_client_user = User.objects.create_user(email='litige-other-client@example.com', password=PASSWORD)
        role, _ = Role.objects.get_or_create(code='client', defaults={'label': 'Client'})
        set_rls_context(user_id=other_client_user.id, organization_id=organization.id)
        Membership.objects.create(user=other_client_user, organization=organization, role=role)
        other_client = APIClient()
        token = other_client.post(
            reverse('login'), {'email': 'litige-other-client@example.com', 'password': PASSWORD}, format='json',
        ).data['access']
        other_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        response = other_client.post(
            reverse('my-lot-litiges', args=[lot.id]), {'description': 'Tentative illégitime.'}, format='json',
        )

        assert response.status_code == 404

    def test_empty_description_is_rejected(self):
        _constructeur_client, organization, _constructeur, _asset, lot = _setup_constructeur_lot(
            'litige-empty-constructeur@example.com', 'Org Litige Empty',
        )
        client, _client_user = _assign_client_to_lot('litige-empty-client@example.com', organization, lot)

        response = client.post(reverse('my-lot-litiges', args=[lot.id]), {'description': '   '}, format='json')

        assert response.status_code == 400

    def test_client_lists_litiges_they_opened_on_their_lot(self):
        _constructeur_client, organization, _constructeur, _asset, lot = _setup_constructeur_lot(
            'litige-list-constructeur@example.com', 'Org Litige List',
        )
        client, _client_user = _assign_client_to_lot('litige-list-client@example.com', organization, lot)
        client.post(reverse('my-lot-litiges', args=[lot.id]), {'description': 'Premier litige.'}, format='json')

        response = client.get(reverse('my-lot-litiges', args=[lot.id]))

        assert response.status_code == 200
        assert len(response.data) == 1
        assert response.data[0]['description'] == 'Premier litige.'
