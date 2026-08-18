import io
import logging

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


def _register_admin(email, organization_name):
    return _register(email, organization_name, role_code='admin_keyimmo')


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

    def test_applied_response_includes_latest_event_id_so_a_legitimate_resync_is_never_rejected(self):
        """Ticket 013 (bug 2 du rapport) : avant correction, `known_latest_
        event_id` n'était jamais rafraîchi côté client après un succès —
        toute tentative suivante, même légitime, se faisait rejeter en
        conflit indéfiniment. La réponse `applied` doit exposer
        `latest_event_id` pour que le client puisse s'en resservir.
        """
        _constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'sync-latest-event-constructeur@example.com', 'Org Sync Latest Event Constructeur',
        )
        inspecteur_client, _inspecteur_organization, _i_user = _setup_inspecteur(
            'sync-latest-event-inspecteur@example.com', 'Org Sync Latest Event Inspecteur',
        )

        first_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
                'correlation_id': '44444444-4444-4444-4444-444444444441',
                'known_latest_event_id': None,
            },
            format='json',
        )
        assert first_response.status_code == 201, first_response.data
        latest_event_id = first_response.data.get('latest_event_id')
        assert latest_event_id, "la réponse 'applied' doit exposer l'identifiant du dernier événement"

        set_rls_context(organization_id=constructeur_organization.id)
        inspection = Inspection.objects.get(id=first_response.data['inspection']['id'])
        actual_event = trust_repository.get_current_status(inspection)
        assert latest_event_id == str(actual_event.id)

        # Deuxième inspection légitime sur la MÊME cible (ex : re-contrôle),
        # portant le `known_latest_event_id` reçu ci-dessus — exactement ce
        # qu'un client corrigé enverrait. Avant correction du bug 2, aucun
        # client ne pouvait jamais produire cette valeur : elle restait
        # `null` pour toujours après le premier succès.
        second_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
                'note': 'Second passage, légitime — pas une écriture concurrente.',
                'correlation_id': '44444444-4444-4444-4444-444444444442',
                'known_latest_event_id': latest_event_id,
            },
            format='json',
        )
        assert second_response.status_code == 201, second_response.data

    def test_latest_event_id_reflects_the_reserve_itself_when_resolving_a_follow_up(self):
        """Scénario exact du parcours manuel (étape 7) : ouverture d'une
        réserve, puis suivi qui la lève. `latest_event_id` doit alors
        pointer vers le DERNIER événement de la RÉSERVE (`levee`), pas vers
        l'événement propre de l'inspection de suivi — c'est cette valeur
        précise que le client devra fournir pour toute action suivante sur
        cette réserve.
        """
        _constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'sync-latest-event-reserve-constructeur@example.com', 'Org Sync Latest Event Reserve Constructeur',
        )
        inspecteur_client, _inspecteur_organization, i_user = _setup_inspecteur(
            'sync-latest-event-reserve-inspecteur@example.com', 'Org Sync Latest Event Reserve Inspecteur',
        )

        open_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.AVEC_RESERVE,
                'correlation_id': '55555555-5555-5555-5555-555555555551',
                'known_latest_event_id': None,
            },
            format='json',
        )
        assert open_response.status_code == 201, open_response.data
        reserve_id = open_response.data['inspection']['opened_reserve']
        # La cible d'un futur conflit pour CET APPEL (sans `reserve` fourni)
        # reste le work_declaration lui-même — sa dernière Inspection étant
        # celle-ci. Un suivi ciblant la RÉSERVE (ci-dessous) compare contre
        # l'événement `ouverte` de la réserve, pas contre cette valeur — les
        # deux cibles sont distinctes par construction (voir
        # `_create_inspection_row`).
        opened_event_id = open_response.data.get('latest_event_id')
        assert opened_event_id

        set_rls_context(user_id=i_user.id, organization_id=constructeur_organization.id)
        reserve = Reserve.objects.get(id=reserve_id)
        reserve_opened_event_id = str(trust_repository.get_current_status(reserve).id)

        follow_up_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'reserve': reserve_id,
                'outcome': InspectionOutcome.CONFORME,
                'note': 'Bornage corrigé, conforme.',
                'correlation_id': '55555555-5555-5555-5555-555555555552',
                'known_latest_event_id': reserve_opened_event_id,
            },
            format='json',
        )
        assert follow_up_response.status_code == 201, follow_up_response.data
        levee_event_id = follow_up_response.data.get('latest_event_id')
        assert levee_event_id
        assert levee_event_id != reserve_opened_event_id

        set_rls_context(organization_id=constructeur_organization.id)
        reserve.refresh_from_db()
        actual_current_event = trust_repository.get_current_status(reserve)
        assert levee_event_id == str(actual_current_event.id)
        assert actual_current_event.source == 'levee'


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
class TestSyncInspectionConflictObservability:
    """Un item rejeté en conflit n'écrit RIEN en base (voir SyncConflict) —
    le correlation ID doit donc rester traçable AILLEURS que dans la table
    `Inspection` : la réponse HTTP elle-même, et les logs serveur. C'est
    précisément dans ce cas (rien à relire en base) qu'on en a le plus
    besoin pour reconstituer, après coup, ce qui s'est passé sur le terrain.
    """

    def test_correlation_id_is_traceable_in_the_conflict_response_and_in_server_logs(self, caplog):
        _constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'sync-conflict-observability-constructeur@example.com', 'Org Sync Conflict Observability Constructeur',
        )
        inspecteur_client, _inspecteur_organization, _i_user = _setup_inspecteur(
            'sync-conflict-observability-inspecteur@example.com', 'Org Sync Conflict Observability Inspecteur',
        )

        first_payload = {
            'organization': str(constructeur_organization.id),
            'work_declaration': str(declaration.id),
            'outcome': InspectionOutcome.CONFORME,
            'correlation_id': '77777777-7777-7777-7777-777777777771',
            'known_latest_event_id': None,
        }
        second_payload = {
            'organization': str(constructeur_organization.id),
            'work_declaration': str(declaration.id),
            'outcome': InspectionOutcome.AVEC_RESERVE,
            'correlation_id': '77777777-7777-7777-7777-777777777772',
            'known_latest_event_id': None,
        }

        # Les DEUX requêtes sous surveillance des logs — l'historique complet
        # nécessaire pour reconstituer l'incident inclut aussi bien l'item
        # qui a réussi que celui rejeté juste après, pas seulement ce
        # dernier isolément.
        with caplog.at_level(logging.INFO, logger='apps.control.services'):
            first_response = inspecteur_client.post(
                reverse('control-sync-inspection'), first_payload, format='json',
            )
            assert first_response.status_code == 201, first_response.data

            second_response = inspecteur_client.post(
                reverse('control-sync-inspection'), second_payload, format='json',
            )
            assert second_response.status_code == 409, second_response.data

        # 1. Le correlation ID de l'item REJETÉ est présent dans la réponse
        # elle-même — rien n'a été écrit en base pour cet item (voir
        # TestSyncInspectionConflict ci-dessus), la réponse HTTP est donc son
        # seul point d'ancrage immédiat côté client.
        assert second_response.data['correlation_id'] == second_payload['correlation_id']

        # 2. Les DEUX correlation ID (celui qui a réussi ET celui rejeté)
        # apparaissent dans les logs serveur — reconstituer l'incident exige
        # de voir les deux tentatives, pas seulement la rejetée isolément.
        assert first_payload['correlation_id'] in caplog.text
        assert second_payload['correlation_id'] in caplog.text

        # 3. Le log de conflit lui-même porte bien le correlation ID de
        # l'item REJETÉ (pas seulement présent quelque part dans le texte
        # combiné — attaché au bon message, au bon niveau).
        conflict_records = [
            record for record in caplog.records
            if record.getMessage().startswith('control_sync_inspection_conflict')
        ]
        assert len(conflict_records) == 1
        assert conflict_records[0].levelname == 'WARNING'
        assert second_payload['correlation_id'] in conflict_records[0].getMessage()
        # ...et n'est jamais mélangé avec celui du premier envoi (qui, lui,
        # n'a jamais généré de log de conflit).
        assert first_payload['correlation_id'] not in conflict_records[0].getMessage()


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


@pytest.mark.django_db
class TestMissionListView:
    """Ticket 012 — `GET /api/control/missions/`, remplaçant `MOCK_MISSIONS`
    côté CONTROL PWA. Critère d'acceptation central : un inspecteur assigné
    voit SA mission même dans une organisation différente de la sienne
    (comportement voulu), mais ne voit RIEN d'autre de cette organisation
    au-delà de cette mission précise.
    """

    def _create_mission(self, *, admin_user, admin_org, organization, declaration, inspector):
        from apps.inspections import services as inspections_services

        return inspections_services.create_mission(
            assigned_by=admin_user, assigned_by_organization_id=admin_org.id,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            assigned_inspector=inspector,
        )

    def test_inspector_sees_their_own_mission_from_another_organization(self):
        admin_client, admin_org, admin_user = _register_admin(
            'missionlist-see-admin@example.com', 'Org MissionList See Admin',
        )
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'missionlist-see-constructeur@example.com', 'Org MissionList See Constructeur',
        )
        inspecteur_client, inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'missionlist-see-inspecteur@example.com', 'Org MissionList See Inspecteur',
        )
        assert inspecteur_organization.id != organization.id

        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=inspecteur_user,
        )

        response = inspecteur_client.get(reverse('control-mission-list'))
        assert response.status_code == 200
        assert len(response.data) == 1
        mission_row = response.data[0]
        assert mission_row['organization_id'] == str(organization.id)
        assert mission_row['work_declaration_id'] == str(declaration.id)
        assert mission_row['lot_name'] == 'Lot'
        assert mission_row['completed'] is False

    def test_inspector_does_not_see_a_mission_assigned_to_someone_else(self):
        admin_client, admin_org, admin_user = _register_admin(
            'missionlist-other-admin@example.com', 'Org MissionList Other Admin',
        )
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'missionlist-other-constructeur@example.com', 'Org MissionList Other Constructeur',
        )
        _other_inspecteur_client, _other_org, other_inspecteur = _setup_inspecteur(
            'missionlist-other-inspecteur-a@example.com', 'Org MissionList Other Inspecteur A',
        )
        watching_client, _watching_org, _watching_user = _setup_inspecteur(
            'missionlist-other-inspecteur-b@example.com', 'Org MissionList Other Inspecteur B',
        )

        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=other_inspecteur,
        )

        response = watching_client.get(reverse('control-mission-list'))
        assert response.status_code == 200
        assert response.data == []

    def test_completed_reflects_an_existing_inspection_by_the_assigned_inspector(self):
        admin_client, admin_org, admin_user = _register_admin(
            'missionlist-done-admin@example.com', 'Org MissionList Done Admin',
        )
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'missionlist-done-constructeur@example.com', 'Org MissionList Done Constructeur',
        )
        inspecteur_client, _inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'missionlist-done-inspecteur@example.com', 'Org MissionList Done Inspecteur',
        )
        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=inspecteur_user,
        )

        inspection_response = inspecteur_client.post(
            reverse('inspection-list'),
            {
                'organization': str(organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
            },
            format='json',
        )
        assert inspection_response.status_code == 201, inspection_response.data

        response = inspecteur_client.get(reverse('control-mission-list'))
        assert response.status_code == 200
        assert response.data[0]['completed'] is True

    def test_a_follow_up_mission_is_not_completed_before_its_own_inspection_exists(self):
        """Friction UX du rapport bout-en-bout (ticket 013 → ticket 014) :
        `completed` se dérivait par `work_declaration`+`inspecteur` SEULS,
        pas par mission — une mission de suivi fraîchement affectée, créée
        APRÈS qu'une première inspection ait déjà eu lieu sur ce même
        `work_declaration`, s'affichait déjà « faite » avant même que
        l'inspecteur n'y touche (la requête trouvait l'ancienne Inspection,
        sans savoir qu'elle datait d'AVANT cette mission-ci).
        """
        admin_client, admin_org, admin_user = _register_admin(
            'missionlist-followup-completed-admin@example.com', 'Org MissionList Followup Completed Admin',
        )
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'missionlist-followup-completed-constructeur@example.com',
            'Org MissionList Followup Completed Constructeur',
        )
        inspecteur_client, _inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'missionlist-followup-completed-inspecteur@example.com', 'Org MissionList Followup Completed Inspecteur',
        )
        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=inspecteur_user,
        )

        open_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(organization.id), 'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.AVEC_RESERVE,
                'correlation_id': '99999999-9999-9999-9999-999999999991',
                'known_latest_event_id': None,
            },
            format='json',
        )
        assert open_response.status_code == 201, open_response.data

        # Mission de suivi, affectée APRÈS la première inspection — jamais
        # touchée par l'inspecteur à ce stade.
        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=inspecteur_user,
        )

        response = inspecteur_client.get(reverse('control-mission-list'))
        assert response.status_code == 200
        # Missions triées par -created_at (list_missions_for_inspector) —
        # l'index 0 est donc la mission de suivi tout juste affectée.
        follow_up_row = response.data[0]
        assert follow_up_row['completed'] is False

    def test_mission_row_reserve_id_is_null_without_any_open_reserve(self):
        """Ticket 013 (bug 3 du rapport) — cas de base : une mission de
        première inspection, sans aucune réserve encore ouverte sur ce lot.
        """
        admin_client, admin_org, admin_user = _register_admin(
            'missionlist-reserve-none-admin@example.com', 'Org MissionList Reserve None Admin',
        )
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'missionlist-reserve-none-constructeur@example.com', 'Org MissionList Reserve None Constructeur',
        )
        inspecteur_client, _inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'missionlist-reserve-none-inspecteur@example.com', 'Org MissionList Reserve None Inspecteur',
        )
        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=inspecteur_user,
        )

        response = inspecteur_client.get(reverse('control-mission-list'))
        assert response.status_code == 200
        assert response.data[0]['reserve_id'] is None

    def test_mission_row_exposes_reserve_id_when_the_lot_has_an_open_reserve(self):
        """Sans ce champ, `CONTROL PWA` n'a structurellement aucun moyen de
        savoir quelle réserve une mission de suivi concerne — c'est la cause
        directe de la friction 2 du rapport (un inspecteur ne peut jamais
        lever une réserve depuis l'app réelle).
        """
        admin_client, admin_org, admin_user = _register_admin(
            'missionlist-reserve-open-admin@example.com', 'Org MissionList Reserve Open Admin',
        )
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'missionlist-reserve-open-constructeur@example.com', 'Org MissionList Reserve Open Constructeur',
        )
        inspecteur_client, _inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'missionlist-reserve-open-inspecteur@example.com', 'Org MissionList Reserve Open Inspecteur',
        )
        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=inspecteur_user,
        )

        open_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(organization.id), 'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.AVEC_RESERVE,
                'correlation_id': '77777777-7777-7777-7777-777777777771',
                'known_latest_event_id': None,
            },
            format='json',
        )
        assert open_response.status_code == 201, open_response.data
        reserve_id = open_response.data['inspection']['opened_reserve']

        # Mission de suivi, affectée APRÈS l'ouverture de la réserve — le
        # scénario réel du rapport (étape 7).
        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=inspecteur_user,
        )

        response = inspecteur_client.get(reverse('control-mission-list'))
        assert response.status_code == 200
        assert len(response.data) == 2
        for mission_row in response.data:
            assert mission_row['reserve_id'] == str(reserve_id)

    def test_mission_row_reserve_id_is_null_once_the_reserve_is_resolved(self):
        """Une fois la réserve levée/rejetée (état terminal, jamais
        « ouvert »), une mission ne doit plus jamais la référencer — sans
        quoi une nouvelle mission de suivi mal affectée pointerait vers une
        réserve déjà close.
        """
        admin_client, admin_org, admin_user = _register_admin(
            'missionlist-reserve-resolved-admin@example.com', 'Org MissionList Reserve Resolved Admin',
        )
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'missionlist-reserve-resolved-constructeur@example.com', 'Org MissionList Reserve Resolved Constructeur',
        )
        inspecteur_client, _inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'missionlist-reserve-resolved-inspecteur@example.com', 'Org MissionList Reserve Resolved Inspecteur',
        )
        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=inspecteur_user,
        )

        open_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(organization.id), 'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.AVEC_RESERVE,
                'correlation_id': '88888888-8888-8888-8888-888888888881',
                'known_latest_event_id': None,
            },
            format='json',
        )
        reserve_id = open_response.data['inspection']['opened_reserve']

        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=inspecteur_user,
        )

        # Scénario réel (bug 3, corrigé) : le brouillon de la mission de
        # suivi amorce `known_latest_event_id` depuis `reserve_latest_event_
        # id`, jamais depuis `latest_event_id` de l'ouverture (une cible
        # différente — voir `test_latest_event_id_reflects_the_reserve_
        # itself...`).
        # Missions triées par `-created_at` (voir `list_missions_for_inspector`)
        # — l'index 0 est donc la mission de suivi tout juste affectée.
        follow_up_mission_row = inspecteur_client.get(reverse('control-mission-list')).data[0]
        assert follow_up_mission_row['reserve_id'] == str(reserve_id)
        reserve_latest_event_id = follow_up_mission_row['reserve_latest_event_id']
        assert reserve_latest_event_id

        follow_up_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(organization.id), 'work_declaration': str(declaration.id),
                'reserve': reserve_id, 'outcome': InspectionOutcome.CONFORME,
                'correlation_id': '88888888-8888-8888-8888-888888888882',
                'known_latest_event_id': reserve_latest_event_id,
            },
            format='json',
        )
        assert follow_up_response.status_code == 201, follow_up_response.data

        response = inspecteur_client.get(reverse('control-mission-list'))
        assert response.status_code == 200
        for mission_row in response.data:
            assert mission_row['reserve_id'] is None

    def test_non_inspector_role_is_rejected(self):
        admin_client, admin_org, admin_user = _register_admin(
            'missionlist-role-admin@example.com', 'Org MissionList Role Admin',
        )
        constructeur_client, _organization, _c_user, _lot, _declaration = _setup_constructeur_org(
            'missionlist-role-constructeur@example.com', 'Org MissionList Role Constructeur',
        )
        response = constructeur_client.get(reverse('control-mission-list'))
        assert response.status_code == 403

    def test_inspector_sees_nothing_else_of_that_organization_beyond_their_own_mission(self):
        """Le cœur du critère d'acceptation : la mission est visible, mais
        RIEN d'autre de cette organisation — ni un second lot sans mission
        assignée, ni une autre Inspection/Reserve, ni les endpoints
        Program/Asset/Lot du ticket 002. La policy RLS élargie par ce
        ticket ne doit élargir l'accès QU'à `InspectionMission`, jamais par
        ricochet à une autre table scopée par organisation.
        """
        admin_client, admin_org, admin_user = _register_admin(
            'missionlist-leak-admin@example.com', 'Org MissionList Leak Admin',
        )
        constructeur_client, organization, c_user, lot, declaration = _setup_constructeur_org(
            'missionlist-leak-constructeur@example.com', 'Org MissionList Leak Constructeur',
        )
        inspecteur_client, _inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'missionlist-leak-inspecteur@example.com', 'Org MissionList Leak Inspecteur',
        )
        self._create_mission(
            admin_user=admin_user, admin_org=admin_org, organization=organization,
            declaration=declaration, inspector=inspecteur_user,
        )

        # Un second lot de la MÊME organisation, sans aucune mission
        # assignée à cet inspecteur — reste invisible.
        set_rls_context(organization_id=organization.id)
        second_lot = Lot.objects.create(organization=organization, asset=lot.asset, name='Lot Sans Mission')
        instantiate_milestones_for_lot(second_lot)

        # Une réserve de cette organisation, ouverte par un AUTRE inspecteur
        # (donc totalement étrangère à la mission de celui qu'on surveille
        # ici) — reste invisible.
        # Résolu AVANT d'enregistrer un second inspecteur : `_setup_inspecteur`
        # bascule le contexte RLS de test vers SA PROPRE organisation
        # (voir `_register`), ce qui masquerait `lot.milestones` (organisation
        # cible) si cette lecture avait lieu après.
        second_milestone_id = str(lot.milestones.order_by('order')[1].id)

        _other_inspecteur_client, _other_org, other_inspecteur = _setup_inspecteur(
            'missionlist-leak-inspecteur-b@example.com', 'Org MissionList Leak Inspecteur B',
        )
        second_declaration_response = constructeur_client.post(
            reverse('workdeclaration-list'),
            {'milestone': second_milestone_id},
            format='json',
        )
        assert second_declaration_response.status_code == 201, second_declaration_response.data
        _other_inspecteur_client.post(
            reverse('inspection-list'),
            {
                'organization': str(organization.id),
                'work_declaration': second_declaration_response.data['id'],
                'outcome': InspectionOutcome.AVEC_RESERVE,
            },
            format='json',
        )

        # La mission de l'inspecteur surveillé reste bien visible...
        mission_response = inspecteur_client.get(reverse('control-mission-list'))
        assert mission_response.status_code == 200
        assert len(mission_response.data) == 1

        # ...mais RIEN d'autre de cette organisation ne l'est.
        assert inspecteur_client.get(reverse('lot-list')).data == []
        assert inspecteur_client.get(reverse('asset-list')).data == []
        assert inspecteur_client.get(reverse('program-list')).data == []
        assert inspecteur_client.get(reverse('reserve-list')).data == []
