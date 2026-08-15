import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.models import Document
from apps.evidence.services import create_work_declaration
from apps.inspections.models import Inspection, InspectionOutcome, Reserve
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot
from apps.trust import repository as trust_repository

PASSWORD = 'strongpass123'


def _register(email, organization_name, role_code='sponsor'):
    """Même technique que les autres apps (JWT réel, nécessaire pour que
    `OrganizationScopeMiddleware` résolve `request.organization`)."""
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


def _setup_constructeur_org(email, organization_name):
    client, organization, user = _register(email, organization_name, role_code='constructeur')
    program = Program.objects.create(organization=organization, name='Programme')
    asset = Asset.objects.create(organization=organization, program=program, name='Bien')
    lot = Lot.objects.create(organization=organization, asset=asset, name='Lot')
    instantiate_milestones_for_lot(lot)
    milestone = lot.milestones.first()
    declaration = create_work_declaration(organization=organization, milestone=milestone, declared_by=user)
    return client, organization, user, lot, declaration


def _setup_inspecteur(email, organization_name):
    return _register(email, organization_name, role_code='inspecteur')


def _jpeg_file(name='photo.jpg'):
    buffer = io.BytesIO()
    Image.new('RGB', (10, 10), (0, 255, 0)).save(buffer, format='JPEG')
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type='image/jpeg')


@pytest.mark.django_db
class TestSyncInspectionApplied:
    """Ticket 010 (passe 2) — critère : une inspection saisie hors ligne se
    synchronise sans perte au retour du réseau."""

    def test_first_sync_of_a_fresh_target_succeeds_and_stores_correlation_id(self):
        _constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'sync-applied-constructeur@example.com', 'Org Sync Applied Constructeur',
        )
        inspecteur_client, _inspecteur_organization, _i_user = _setup_inspecteur(
            'sync-applied-inspecteur@example.com', 'Org Sync Applied Inspecteur',
        )
        correlation_id = '11111111-1111-1111-1111-111111111111'

        response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.AVEC_RESERVE,
                'note': 'Checklist: Sécurité ✓\nCommentaire: fissure visible',
                'correlation_id': correlation_id,
                'known_latest_event_id': None,
            },
            format='json',
        )

        assert response.status_code == 201, response.data
        assert response.data['status'] == 'applied'
        assert response.data['inspection']['client_correlation_id'] == correlation_id

        set_rls_context(organization_id=constructeur_organization.id)
        inspection = Inspection.objects.get(id=response.data['inspection']['id'])
        assert str(inspection.client_correlation_id) == correlation_id


@pytest.mark.django_db
class TestSyncInspectionConflict:
    """Ticket 010 (passe 2) — critère le plus important : deux mises à jour
    concurrentes sur la même cible ne provoquent JAMAIS un écrasement
    silencieux. Scénario simulé : deux inspecteurs (ou le même appareil,
    deux brouillons) ont chacun saisi une inspection hors ligne sur le même
    `work_declaration`, tous deux sans avoir jamais observé le moindre
    événement pour cette cible (`known_latest_event_id=None`, cas réel d'une
    saisie faite intégralement en mode avion, passe 1). Le premier arrivé
    l'emporte ; le second doit être rejeté en conflit — jamais fusionné,
    jamais silencieusement ignoré.
    """

    def test_second_concurrent_submission_is_rejected_as_conflict_not_overwritten(self):
        _constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'sync-conflict-constructeur@example.com', 'Org Sync Conflict Constructeur',
        )
        inspecteur_client, _inspecteur_organization, _i_user = _setup_inspecteur(
            'sync-conflict-inspecteur@example.com', 'Org Sync Conflict Inspecteur',
        )

        first_payload = {
            'organization': str(constructeur_organization.id),
            'work_declaration': str(declaration.id),
            'outcome': InspectionOutcome.CONFORME,
            'note': 'Premier inspecteur : conforme',
            'correlation_id': '22222222-2222-2222-2222-222222222221',
            'known_latest_event_id': None,
        }
        second_payload = {
            'organization': str(constructeur_organization.id),
            'work_declaration': str(declaration.id),
            'outcome': InspectionOutcome.AVEC_RESERVE,
            'note': 'Second inspecteur : réserve — ne doit jamais écraser le premier',
            'correlation_id': '22222222-2222-2222-2222-222222222222',
            # Saisi hors ligne AVANT de connaître le résultat du premier —
            # exactement le scénario de deux mises à jour concurrentes.
            'known_latest_event_id': None,
        }

        first_response = inspecteur_client.post(
            reverse('control-sync-inspection'), first_payload, format='json',
        )
        assert first_response.status_code == 201, first_response.data
        assert first_response.data['status'] == 'applied'

        second_response = inspecteur_client.post(
            reverse('control-sync-inspection'), second_payload, format='json',
        )
        assert second_response.status_code == 409, second_response.data
        assert second_response.data['status'] == 'conflict'
        assert second_response.data['current_event']['source'] == 'inspection_conforme'

        # Aucun écrasement silencieux : une seule Inspection existe pour ce
        # work_declaration — celle du premier envoi, avec sa note d'origine
        # intacte, jamais remplacée par celle du second.
        set_rls_context(organization_id=constructeur_organization.id)
        inspections = list(Inspection.objects.filter(work_declaration=declaration))
        assert len(inspections) == 1
        assert inspections[0].note == 'Premier inspecteur : conforme'
        assert str(inspections[0].client_correlation_id) == first_payload['correlation_id']

    def test_follow_up_inspection_on_a_reserve_also_detects_concurrent_modification(self):
        """Même règle appliquée à une `Reserve` (l'autre cible nommée par le
        ticket) : deux inspections de suivi concurrentes sur la même réserve
        ouverte, toutes deux fondées sur l'état "ouverte" observé avant
        déconnexion — seule la première doit faire progresser la réserve.
        """
        _constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'sync-conflict-reserve-constructeur@example.com', 'Org Sync Conflict Reserve Constructeur',
        )
        inspecteur_client, _inspecteur_organization, i_user = _setup_inspecteur(
            'sync-conflict-reserve-inspecteur@example.com', 'Org Sync Conflict Reserve Inspecteur',
        )

        open_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.AVEC_RESERVE,
                'correlation_id': '33333333-3333-3333-3333-333333333330',
                'known_latest_event_id': None,
            },
            format='json',
        )
        assert open_response.status_code == 201, open_response.data
        reserve_id = open_response.data['inspection']['opened_reserve']
        assert reserve_id is not None

        set_rls_context(user_id=i_user.id, organization_id=constructeur_organization.id)
        reserve = Reserve.objects.get(id=reserve_id)
        known_event_id = str(trust_repository.get_current_status(reserve).id)

        # Deux inspections de suivi, saisies hors ligne à partir du MÊME état
        # connu ("ouverte") — un vrai scénario de deux appareils déconnectés
        # inspectant la même réserve avant que l'un des deux ne resynchronise.
        first_follow_up = {
            'organization': str(constructeur_organization.id),
            'work_declaration': str(declaration.id),
            'reserve': reserve_id,
            'outcome': InspectionOutcome.CONFORME,
            'correlation_id': '33333333-3333-3333-3333-333333333331',
            'known_latest_event_id': known_event_id,
        }
        second_follow_up = {
            'organization': str(constructeur_organization.id),
            'work_declaration': str(declaration.id),
            'reserve': reserve_id,
            'outcome': InspectionOutcome.AVEC_RESERVE,
            'correlation_id': '33333333-3333-3333-3333-333333333332',
            'known_latest_event_id': known_event_id,
        }

        first_response = inspecteur_client.post(
            reverse('control-sync-inspection'), first_follow_up, format='json',
        )
        assert first_response.status_code == 201, first_response.data

        second_response = inspecteur_client.post(
            reverse('control-sync-inspection'), second_follow_up, format='json',
        )
        assert second_response.status_code == 409, second_response.data

        # La réserve a progressé une seule fois (levée par le premier suivi),
        # jamais rouverte/écrasée par le second.
        set_rls_context(organization_id=constructeur_organization.id)
        reserve.refresh_from_db()
        events = list(
            trust_repository.list_for_subject(reserve).order_by('created_at').values_list('source', flat=True),
        )
        assert events == ['ouverte', 'nouvelle_inspection', 'levee']


@pytest.mark.django_db
class TestSyncInspectionPermission:
    def test_constructeur_cannot_call_the_sync_endpoint(self):
        constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'sync-perm-constructeur@example.com', 'Org Sync Perm Constructeur',
        )

        response = constructeur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
                'correlation_id': '44444444-4444-4444-4444-444444444444',
            },
            format='json',
        )

        assert response.status_code == 403


@pytest.mark.django_db
class TestSyncMediaQueue:
    """Ticket 010 (passe 2) — file média : un inspecteur peut synchroniser
    une photo puis une Evidence vers l'organisation cible bien qu'il n'en
    soit jamais membre (règle d'indépendance)."""

    def test_document_then_evidence_are_synced_into_the_target_organization(self):
        _constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'sync-media-constructeur@example.com', 'Org Sync Media Constructeur',
        )
        inspecteur_client, _inspecteur_organization, _i_user = _setup_inspecteur(
            'sync-media-inspecteur@example.com', 'Org Sync Media Inspecteur',
        )

        document_response = inspecteur_client.post(
            reverse('control-sync-document'),
            {
                'organization': str(constructeur_organization.id),
                'file': _jpeg_file('facade.jpg'),
                'category': 'photo_inspection',
                'source': 'mobile_app_photo',
                'correlation_id': '55555555-5555-5555-5555-555555555551',
            },
            format='multipart',
        )
        assert document_response.status_code == 201, document_response.data

        set_rls_context(organization_id=constructeur_organization.id)
        document = Document.objects.get(id=document_response.data['id'])
        assert document.organization_id == constructeur_organization.id

        evidence_response = inspecteur_client.post(
            reverse('control-sync-evidence'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'documents': [document_response.data['id']],
                'correlation_id': '55555555-5555-5555-5555-555555555552',
            },
            format='json',
        )
        assert evidence_response.status_code == 201, evidence_response.data
        # `response.data` (avant rendu JSON) contient un vrai `UUID`, jamais
        # une chaîne — même piège déjà rencontré aux tickets 008/009.
        assert evidence_response.data['work_declaration'] == declaration.id

    def test_a_failed_or_missing_photo_does_not_block_the_inspection_data_sync(self):
        """La checklist/le commentaire/la décision se synchronisent
        indépendamment de la file média — cible toujours `work_declaration`,
        jamais `evidence` (voir SyncInspectionSerializer)."""
        _constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'sync-media-independent-constructeur@example.com', 'Org Sync Media Independent Constructeur',
        )
        inspecteur_client, _inspecteur_organization, _i_user = _setup_inspecteur(
            'sync-media-independent-inspecteur@example.com', 'Org Sync Media Independent Inspecteur',
        )

        # Aucune photo synchronisée du tout — la synchronisation de
        # l'inspection réussit quand même.
        response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
                'correlation_id': '66666666-6666-6666-6666-666666666666',
                'known_latest_event_id': None,
            },
            format='json',
        )
        assert response.status_code == 201, response.data
