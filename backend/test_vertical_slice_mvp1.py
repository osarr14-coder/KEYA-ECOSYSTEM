"""Test bout-en-bout du vertical slice MVP 1 (tickets 001-013), doctrine
V3.0 section 22.4. Contrairement aux tests par ticket (chacun isolé dans
son app), ce fichier enchaîne TOUTE la chaîne réelle en un seul scénario,
via de vrais appels API (JWT réel, permissions réelles, RLS réelle) — pas
des appels directs aux fonctions de service, précisément pour détecter les
frictions d'intégration qu'un test par ticket ne peut pas voir.

Reprise après le ticket 012 (affectation de mission) : les étapes
inspecteur passent par le VRAI protocole CONTROL (`apps.control` —
`GET /api/control/missions/`, `POST /api/control/sync/...`), aucun mock.

Cette reprise avait initialement révélé deux frictions bloquant l'étape 7
(mission de suivi) — corrigées depuis par le ticket 013 :

1. `GET /api/control/missions/` n'exposait aucun `reserve_id`/
   `reserve_latest_event_id` — un inspecteur n'avait aucun moyen de savoir,
   depuis la liste réelle, qu'une mission concernait une inspection de
   SUIVI, ni quel `known_latest_event_id` fournir pour son premier essai.
2. Un inspecteur n'avait AUCUN moyen légitime d'apprendre le dernier
   `TrustEvent` réel d'une `Reserve` cross-organisation. Toute inspection
   de suivi soumise avec `known_latest_event_id=None` (la seule valeur
   qu'un inspecteur pouvait alors fournir) était rejetée en conflit — pas
   un cas limite, le chemin normal d'usage.

L'étape 7 ci-dessous n'utilise plus aucun raccourci ORM privilégié : elle
lit `reserve_id`/`reserve_latest_event_id` depuis la vraie liste de
missions, exactement comme `apps/control-pwa` le fait désormais (voir
`sync/syncEngine.ts::syncDraft` et `db/repository.ts::createEmptyDraft`).

Volontairement à la racine du repo (pas dans un `apps/*`) : ce scénario
n'appartient à aucun domaine métier en particulier, il les traverse tous.
"""

import io
import uuid

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import LotClient
from apps.trust.models import TrustLevel
from apps.trust.services import LEVEL_PROGRESS_FRACTION

PASSWORD = 'strongpass123'
SENEGAL_MILESTONE_COUNT = 8  # voir apps/programs/migrations/0003 — 'foncier' en premier


def _register(email, organization_name, role_code='sponsor'):
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


def _jpeg_file(name):
    buffer = io.BytesIO()
    Image.new('RGB', (12, 12), (10, 200, 30)).save(buffer, format='JPEG')
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type='image/jpeg')


@pytest.mark.django_db
class TestVerticalSliceMVP1:
    def test_full_chain_from_program_creation_to_client_visible_resolved_reserve(self):
        # --- 1. Programme → Bien → Lot, jalons auto-instanciés (API navigable) ---
        constructeur_client, organization, constructeur_user = _register(
            'e2e2-constructeur@example.com', 'Org E2E2 Constructeur', role_code='constructeur',
        )

        program_response = constructeur_client.post(
            reverse('program-list'), {'name': 'Programme Keur Massar'}, format='json',
        )
        assert program_response.status_code == 201, program_response.data
        program_id = program_response.data['id']

        asset_response = constructeur_client.post(
            reverse('asset-list'),
            {'program': program_id, 'name': 'Résidence Ker', 'location': 'Keur Massar'},
            format='json',
        )
        assert asset_response.status_code == 201, asset_response.data
        asset_id = asset_response.data['id']

        lot_response = constructeur_client.post(
            reverse('lot-list'), {'asset': asset_id, 'name': 'Lot 12'}, format='json',
        )
        assert lot_response.status_code == 201, lot_response.data
        lot_id = lot_response.data['id']

        from apps.programs.models import Lot
        lot = Lot.objects.get(id=lot_id)
        milestones = list(lot.milestones.order_by('order'))
        assert len(milestones) == SENEGAL_MILESTONE_COUNT, (
            'Les jalons ne se sont pas auto-instanciés depuis le MilestoneTemplate Sénégal '
            '(ticket 002) à la création du lot.'
        )
        first_milestone = milestones[0]
        assert first_milestone.code == 'foncier'

        # --- 2. Le constructeur déclare un travail terminé (API navigable) ---
        declaration_response = constructeur_client.post(
            reverse('workdeclaration-list'),
            {'milestone': str(first_milestone.id), 'note': 'Titre foncier obtenu et déposé.'},
            format='json',
        )
        assert declaration_response.status_code == 201, declaration_response.data
        declaration_id = declaration_response.data['id']

        # --- 3. Il attache des preuves (2 photos + 1 document) — mêmes ---
        #        endpoints que ceux réellement appelés par l'écran BUILD
        #        « Documenter » (ExceptionsView.tsx::DocumentManquantRow).
        photo1_response = constructeur_client.post(
            reverse('document-list'),
            {'file': _jpeg_file('titre_recto.jpg'), 'category': 'titre_foncier', 'source': 'mobile_app_photo'},
            format='multipart',
        )
        assert photo1_response.status_code == 201, photo1_response.data
        photo2_response = constructeur_client.post(
            reverse('document-list'),
            {'file': _jpeg_file('titre_verso.jpg'), 'category': 'titre_foncier', 'source': 'mobile_app_photo'},
            format='multipart',
        )
        assert photo2_response.status_code == 201, photo2_response.data

        evidence_response = constructeur_client.post(
            reverse('evidence-list'),
            {
                'work_declaration': declaration_id,
                'documents': [photo1_response.data['id'], photo2_response.data['id']],
            },
            format='json',
        )
        assert evidence_response.status_code == 201, evidence_response.data

        # --- 4. admin_keyimmo affecte un inspecteur indépendant (ticket 012) ---
        admin_client, admin_org, admin_user = _register(
            'e2e2-admin@example.com', 'Org E2E2 Admin', role_code='admin_keyimmo',
        )
        inspecteur_client, inspecteur_organization, inspecteur_user = _register(
            'e2e2-inspecteur@example.com', 'Org E2E2 Inspecteur', role_code='inspecteur',
        )
        assert inspecteur_organization.id != organization.id, (
            'Règle d\'indépendance (ticket 005) : l\'inspecteur doit être dans une autre '
            'organisation que le lot inspecté.'
        )

        mission1_response = admin_client.post(
            reverse('backoffice-mission-create'),
            {
                'organization': str(organization.id),
                'work_declaration': declaration_id,
                'assigned_inspector': str(inspecteur_user.id),
            },
            format='json',
        )
        assert mission1_response.status_code == 201, mission1_response.data

        # --- 5. L'inspecteur voit la mission (vrai endpoint), mène ---
        #        l'inspection via le vrai protocole de synchronisation
        #        CONTROL (ticket 010), la valide avec une réserve --------
        missions_before_response = inspecteur_client.get(reverse('control-mission-list'))
        assert missions_before_response.status_code == 200
        assert len(missions_before_response.data) == 1
        mission_row = missions_before_response.data[0]
        assert mission_row['work_declaration_id'] == declaration_id
        assert mission_row['organization_id'] == str(organization.id)
        assert mission_row['lot_name'] == 'Lot 12'
        assert mission_row['completed'] is False
        # Ticket 013 : aucune réserve encore ouverte sur ce lot à ce stade —
        # les deux champs sont explicitement `None`, jamais absents.
        assert mission_row['reserve_id'] is None
        assert mission_row['reserve_latest_event_id'] is None

        inspection1_correlation_id = str(uuid.uuid4())
        inspector_photo_response = inspecteur_client.post(
            reverse('control-sync-document'),
            {
                'organization': str(organization.id),
                'file': _jpeg_file('facade_lot12.jpg'),
                'category': 'photo_inspection',
                'source': 'mobile_app_photo',
                'correlation_id': inspection1_correlation_id,
            },
            format='multipart',
        )
        assert inspector_photo_response.status_code == 201, inspector_photo_response.data

        inspector_evidence_response = inspecteur_client.post(
            reverse('control-sync-evidence'),
            {
                'organization': str(organization.id),
                'work_declaration': declaration_id,
                'documents': [inspector_photo_response.data['id']],
                'correlation_id': inspection1_correlation_id,
            },
            format='json',
        )
        assert inspector_evidence_response.status_code == 201, inspector_evidence_response.data

        inspection1_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(organization.id),
                'work_declaration': declaration_id,
                'outcome': 'avec_reserve',
                'note': 'Limite de propriété à clarifier avec le voisin.',
                'correlation_id': inspection1_correlation_id,
                'known_latest_event_id': None,
            },
            format='json',
        )
        assert inspection1_response.status_code == 201, inspection1_response.data
        assert inspection1_response.data['status'] == 'applied'
        reserve_id = inspection1_response.data['inspection']['opened_reserve']
        assert reserve_id is not None
        # Ticket 013 (bug 2) : présent sur toute réponse 'applied' — c'est
        # cette valeur qu'un client repartirait pour resynchroniser
        # légitimement CETTE cible précise (le work_declaration, pas la
        # réserve — voir étape 7 pour la distinction).
        assert inspection1_response.data.get('latest_event_id')

        reserve_status_response = constructeur_client.get(reverse('reserve-detail', args=[reserve_id]))
        assert reserve_status_response.status_code == 200
        assert reserve_status_response.data['status'] == 'ouverte'

        # La mission #1 est maintenant correctement dérivée « faite ».
        missions_after_first_response = inspecteur_client.get(reverse('control-mission-list'))
        assert missions_after_first_response.data[0]['completed'] is True

        # --- 6. Le constructeur documente une correction (BUILD réel : ---
        #        ExceptionsView.tsx::ReserveCorrectionForm appelle les
        #        MÊMES endpoints) — sans changer le statut lui-même -------
        correction_photo_response = constructeur_client.post(
            reverse('document-list'),
            {'file': _jpeg_file('bornage_corrige.jpg'), 'category': 'correction', 'source': 'mobile_app_photo'},
            format='multipart',
        )
        assert correction_photo_response.status_code == 201, correction_photo_response.data

        correction_evidence_response = constructeur_client.post(
            reverse('evidence-list'),
            {'work_declaration': declaration_id, 'documents': [correction_photo_response.data['id']]},
            format='json',
        )
        assert correction_evidence_response.status_code == 201, correction_evidence_response.data

        correction_response = constructeur_client.post(
            reverse('reservecorrection-list'),
            {'reserve': reserve_id, 'evidence': correction_evidence_response.data['id']},
            format='json',
        )
        assert correction_response.status_code == 201, correction_response.data

        status_after_correction = constructeur_client.get(reverse('reserve-detail', args=[reserve_id]))
        assert status_after_correction.data['status'] == 'correction_proposee'
        assert correction_response.data.get('status') is None, (
            'ReserveCorrectionCreateSerializer ne doit exposer aucun champ status en entrée.'
        )

        # --- 7. admin_keyimmo affecte une mission de suivi, l'inspecteur ---
        #        la mène, la réserve est levée ------------------------------
        mission2_response = admin_client.post(
            reverse('backoffice-mission-create'),
            {
                'organization': str(organization.id),
                'work_declaration': declaration_id,
                'assigned_inspector': str(inspecteur_user.id),
            },
            format='json',
        )
        assert mission2_response.status_code == 201, mission2_response.data

        missions_with_followup_response = inspecteur_client.get(reverse('control-mission-list'))
        assert missions_with_followup_response.status_code == 200
        assert len(missions_with_followup_response.data) == 2
        # Missions triées par -created_at (list_missions_for_inspector) :
        # l'index 0 est la mission de suivi tout juste affectée, l'index 1
        # la première mission (déjà réalisée à l'étape 4).
        followup_mission_row, first_mission_row = missions_with_followup_response.data
        # Ticket 014 (corrige la limite documentée au ticket 013) :
        # `completed` distingue désormais correctement la mission de suivi
        # — jamais traitée à ce stade — de la première mission, déjà
        # réalisée sur ce même work_declaration. Avant correction,
        # `completed` était dérivé par work_declaration+inspecteur SEULS
        # (sans borne temporelle par mission), donc les DEUX lignes
        # ressortaient à tort « faites ».
        assert followup_mission_row['completed'] is False
        assert first_mission_row['completed'] is True
        # Ticket 013 (bug 3, corrigé) : les DEUX lignes exposent désormais la
        # réserve réellement ouverte sur ce lot — c'est ce que
        # `apps/control-pwa` lit pour amorcer `InspectionDraft.
        # knownLatestEventId` d'un brouillon neuf (voir
        # `db/repository.ts::createEmptyDraft`).
        assert followup_mission_row['reserve_id'] == str(reserve_id)
        known_latest_event_id = followup_mission_row['reserve_latest_event_id']
        assert known_latest_event_id, (
            'Sans cette valeur, le premier essai de synchronisation d\'un brouillon neuf sur cette '
            'mission de suivi serait rejeté en conflit — voir ticket 013, bug 3.'
        )

        followup_correlation_id = str(uuid.uuid4())

        # Plus aucun raccourci ORM : `known_latest_event_id` vient
        # EXCLUSIVEMENT de la vraie liste de missions ci-dessus — exactement
        # ce qu'un inspecteur réel obtient via l'app.
        inspection2_response = inspecteur_client.post(
            reverse('control-sync-inspection'),
            {
                'organization': str(organization.id),
                'work_declaration': declaration_id,
                'outcome': 'conforme',
                'reserve': reserve_id,
                'note': 'Bornage corrigé, conforme.',
                'correlation_id': followup_correlation_id,
                'known_latest_event_id': known_latest_event_id,
            },
            format='json',
        )
        assert inspection2_response.status_code == 201, inspection2_response.data
        assert inspection2_response.data['status'] == 'applied'
        assert inspection2_response.data.get('latest_event_id')

        # Une fois la réserve levée, plus aucune mission ne doit encore la
        # référencer comme « ouverte ».
        missions_after_resolution_response = inspecteur_client.get(reverse('control-mission-list'))
        assert all(
            row['reserve_id'] is None for row in missions_after_resolution_response.data
        ), 'La réserve levée ne doit plus apparaître comme ouverte sur aucune mission de ce lot.'

        final_status_response = constructeur_client.get(reverse('reserve-detail', args=[reserve_id]))
        assert final_status_response.data['status'] == 'levee'

        # --- 8. Le client (HOME) voit l'avancement à jour, l'événement ---
        #        récent, et la réserve désormais résolue -------------------
        client_role, _ = Role.objects.get_or_create(code='client', defaults={'label': 'Client'})
        client_user = User.objects.create_user(email='e2e2-client@example.com', password=PASSWORD)
        set_rls_context(user_id=client_user.id, organization_id=organization.id)
        Membership.objects.create(user=client_user, organization=organization, role=client_role)
        LotClient.objects.create(organization=organization, lot=lot, client=client_user)

        client_client = APIClient()
        client_token = client_client.post(
            reverse('login'), {'email': 'e2e2-client@example.com', 'password': PASSWORD}, format='json',
        ).data['access']
        client_client.credentials(HTTP_AUTHORIZATION=f'Bearer {client_token}')

        my_lots_response = client_client.get(reverse('my-lots'))
        assert my_lots_response.status_code == 200
        assert len(my_lots_response.data) == 1
        assert my_lots_response.data[0]['id'] == str(lot.id)

        overview_response = client_client.get(reverse('my-lot-overview', args=[lot.id]))
        assert overview_response.status_code == 200
        overview = overview_response.data

        assert overview['open_reserve'] is None, (
            'La réserve levée apparaît encore comme réserve ouverte côté HOME.'
        )
        assert overview['latest_notable_event']['source'] == 'levee'
        assert overview['latest_notable_event']['level'] == TrustLevel.VALIDE

        milestone_payload = next(m for m in overview['milestones'] if m['code'] == 'foncier')
        assert milestone_payload['level'] == TrustLevel.VERIFIE, (
            f"Le jalon 'foncier' devrait refléter le niveau de la 2e inspection (verifie), "
            f"pas rester sur celui de la 1re (controle) — obtenu : {milestone_payload['level']}"
        )

        expected_percentage = round(LEVEL_PROGRESS_FRACTION[TrustLevel.VERIFIE] / SENEGAL_MILESTONE_COUNT)
        assert overview['progress_percentage'] == expected_percentage

        # Fil de preuves : les DEUX Evidence constructeur (déclaration
        # initiale + correction) — l'Evidence de l'INSPECTEUR (ses propres
        # photos, ticket 010) n'y figure pas : c'est une Evidence à part,
        # rattachée au même work_declaration mais jamais mélangée au fil de
        # preuves du constructeur. Comportement volontaire, pas une omission
        # — signalé ici pour rester visible.
        evidence_feed_response = client_client.get(reverse('my-lot-evidence', args=[lot.id]))
        assert evidence_feed_response.status_code == 200
        assert len(evidence_feed_response.data) == 3, (
            'Attendu : 2 Evidence constructeur + 1 Evidence inspecteur (ses propres photos, '
            'synchronisées via /api/control/sync/evidence/) — les trois rattachées au même '
            'work_declaration, HOME ne les distingue pas par auteur.'
        )
        total_documents = sum(item['document_count'] for item in evidence_feed_response.data)
        assert total_documents == 4  # 2 photos constructeur + 1 correction + 1 photo inspecteur

        # --- Bonus : cohérence avec BUILD (ticket 009) --------------------
        exceptions_response = constructeur_client.get(reverse('build-exceptions'))
        assert exceptions_response.status_code == 200
        open_reserve_ids = {row['reserve_id'] for row in exceptions_response.data['reserves_ouvertes']}
        assert str(reserve_id) not in open_reserve_ids, (
            'La réserve levée apparaît encore dans "réserves ouvertes" côté BUILD.'
        )

        all_lots_response = constructeur_client.get(reverse('build-lots'))
        assert all_lots_response.status_code == 200
        build_row = next(row for row in all_lots_response.data['results'] if row['id'] == str(lot.id))
        assert build_row['open_reserve_count'] == 0

        # Constat DÉLIBÉRÉ, pas un bug (déjà documenté au ticket 009) :
        # BUILD et HOME calculent deux pourcentages différents pour le même
        # lot — rendu visible en valeurs réelles.
        build_expected_percentage = round((1 / SENEGAL_MILESTONE_COUNT) * LEVEL_PROGRESS_FRACTION[TrustLevel.DECLARE])
        assert build_row['progress_percentage'] == build_expected_percentage
        assert build_row['progress_percentage'] != overview['progress_percentage']
