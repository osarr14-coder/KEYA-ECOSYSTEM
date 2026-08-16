"""Test bout-en-bout du vertical slice MVP 1 (tickets 001-011), doctrine
V3.0 section 22.4. Contrairement aux tests par ticket (chacun isolé dans
son app), ce fichier enchaîne TOUTE la chaîne réelle en un seul scénario,
via de vrais appels API (JWT réel, permissions réelles, RLS réelle) — pas
des appels directs aux fonctions de service, précisément pour détecter les
frictions d'intégration qu'un test par ticket ne peut pas voir (un champ
mal nommé entre deux apps, un statut mal dérivé une fois plusieurs
événements empilés, etc.).

Volontairement à la racine du repo (pas dans un `apps/*`) : ce scénario
n'appartient à aucun domaine métier en particulier, il les traverse tous.
"""

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.inspections.models import InspectionOutcome
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import LotClient
from apps.trust.services import LEVEL_PROGRESS_FRACTION
from apps.trust.models import TrustLevel

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
        # --- 1. Programme → Bien → Lot, jalons auto-instanciés ---------
        constructeur_client, organization, constructeur_user = _register(
            'e2e-constructeur@example.com', 'Org E2E Constructeur', role_code='constructeur',
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

        # --- 2. Le constructeur déclare un travail terminé sur ce jalon -
        declaration_response = constructeur_client.post(
            reverse('workdeclaration-list'),
            {'milestone': str(first_milestone.id), 'note': 'Titre foncier obtenu et déposé.'},
            format='json',
        )
        assert declaration_response.status_code == 201, declaration_response.data
        declaration_id = declaration_response.data['id']

        # --- 3. Il attache des preuves (2 photos + 1 document) ---------
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

        # --- 4. Un inspecteur indépendant inspecte, ouvre une réserve ---
        inspecteur_client, inspecteur_organization, _inspecteur_user = _register(
            'e2e-inspecteur@example.com', 'Org E2E Inspecteur', role_code='inspecteur',
        )
        assert inspecteur_organization.id != organization.id, (
            'Règle d\'indépendance (ticket 005) : l\'inspecteur doit être dans une autre '
            'organisation que le lot inspecté.'
        )

        inspection1_response = inspecteur_client.post(
            reverse('inspection-list'),
            {
                'organization': str(organization.id),
                'work_declaration': declaration_id,
                'outcome': InspectionOutcome.AVEC_RESERVE,
                'note': 'Limite de propriété à clarifier avec le voisin.',
            },
            format='json',
        )
        assert inspection1_response.status_code == 201, inspection1_response.data
        reserve_id = inspection1_response.data['opened_reserve']
        assert reserve_id is not None

        reserve_status_response = constructeur_client.get(reverse('reserve-detail', args=[reserve_id]))
        assert reserve_status_response.status_code == 200
        assert reserve_status_response.data['status'] == 'ouverte'

        # --- 5. Le constructeur documente une correction ----------------
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
        # Critère explicite du ticket 005 : documenter une correction ne
        # change JAMAIS le statut directement — c'est un événement de plus,
        # jamais un raccourci.
        assert correction_response.data.get('status') is None, (
            'ReserveCorrectionCreateSerializer ne doit exposer aucun champ status en entrée.'
        )

        # --- 6. Nouvelle inspection : la réserve est levée ---------------
        inspection2_response = inspecteur_client.post(
            reverse('inspection-list'),
            {
                'organization': str(organization.id),
                'work_declaration': declaration_id,
                'outcome': InspectionOutcome.CONFORME,
                'reserve': reserve_id,
                'note': 'Bornage corrigé, conforme.',
            },
            format='json',
        )
        assert inspection2_response.status_code == 201, inspection2_response.data

        final_status_response = constructeur_client.get(reverse('reserve-detail', args=[reserve_id]))
        assert final_status_response.data['status'] == 'levee'

        # --- 7. Le client (HOME) voit l'avancement, l'événement récent, -
        #        et la réserve désormais résolue -----------------------
        # `_register` créerait une organisation NEUVE (bootstrap, ticket
        # 001) — un client doit au contraire REJOINDRE l'organisation
        # EXISTANTE du lot (même technique que apps/home/tests.py
        # ::_assign_client_to_lot) : sans quoi son organisation active
        # (résolue par le middleware depuis SA PROPRE Membership) ne
        # correspondrait jamais à celle du lot, et la RLS masquerait tout —
        # piège rencontré une première fois en écrivant ce test.
        client_role, _ = Role.objects.get_or_create(code='client', defaults={'label': 'Client'})
        client_user = User.objects.create_user(email='e2e-client@example.com', password=PASSWORD)
        set_rls_context(user_id=client_user.id, organization_id=organization.id)
        Membership.objects.create(user=client_user, organization=organization, role=client_role)
        LotClient.objects.create(organization=organization, lot=lot, client=client_user)

        client_client = APIClient()
        client_token = client_client.post(
            reverse('login'), {'email': 'e2e-client@example.com', 'password': PASSWORD}, format='json',
        ).data['access']
        client_client.credentials(HTTP_AUTHORIZATION=f'Bearer {client_token}')

        my_lots_response = client_client.get(reverse('my-lots'))
        assert my_lots_response.status_code == 200
        assert len(my_lots_response.data) == 1
        assert my_lots_response.data[0]['id'] == str(lot.id)

        overview_response = client_client.get(reverse('my-lot-overview', args=[lot.id]))
        assert overview_response.status_code == 200
        overview = overview_response.data

        # Réserve désormais résolue : n'apparaît plus comme "problème
        # principal" (critère produit 26.1, ticket 008).
        assert overview['open_reserve'] is None, (
            'La réserve levée apparaît encore comme réserve ouverte côté HOME — '
            'incohérence entre apps.inspections (statut dérivé) et apps.home (get_open_reserve).'
        )

        # Dernier événement notable = la levée de la réserve (le tout
        # dernier événement chronologique de toute la chaîne) — preuve que
        # HOME agrège bien TOUS les sujets (WorkDeclaration/Evidence/
        # Inspection/Reserve), pas seulement le jalon lui-même.
        assert overview['latest_notable_event']['source'] == 'levee'
        assert overview['latest_notable_event']['level'] == TrustLevel.VALIDE

        # Le jalon "foncier" (le seul touché) doit refléter le niveau de la
        # DEUXIÈME inspection (verifie), pas celui de la première
        # (controle, avec réserve) — preuve que le statut dérivé progresse
        # bien avec la nouvelle inspection, jamais figé sur le premier
        # événement.
        milestone_payload = next(m for m in overview['milestones'] if m['code'] == 'foncier')
        assert milestone_payload['level'] == TrustLevel.VERIFIE, (
            f"Le jalon 'foncier' devrait refléter le niveau de la 2e inspection (verifie), "
            f"pas rester sur celui de la 1re (controle) — obtenu : {milestone_payload['level']}"
        )

        # Progression globale : SEUL le premier jalon (sur 8) a progressé,
        # jusqu'à 'verifie' (80) — les 7 autres restent à 0. Assertion
        # exacte (pas seulement "> 0") pour prouver que le calcul de bout
        # en bout est réellement correct, pas juste non-nul par accident.
        expected_percentage = round(LEVEL_PROGRESS_FRACTION[TrustLevel.VERIFIE] / SENEGAL_MILESTONE_COUNT)
        assert overview['progress_percentage'] == expected_percentage

        # Fil de preuves : les DEUX Evidence (déclaration initiale +
        # correction) doivent apparaître, dans l'ordre chronologique inverse.
        evidence_feed_response = client_client.get(reverse('my-lot-evidence', args=[lot.id]))
        assert evidence_feed_response.status_code == 200
        assert len(evidence_feed_response.data) == 2
        total_documents = sum(item['document_count'] for item in evidence_feed_response.data)
        assert total_documents == 3  # 2 photos initiales + 1 photo de correction

        # --- Bonus : cohérence avec BUILD (ticket 009), qui dérive du même
        #     Reserve/TrustEvent — pas demandé explicitement dans les 7
        #     étapes, mais c'est exactement le genre d'endroit où deux
        #     écrans pourraient diverger silencieusement l'un de l'autre.
        exceptions_response = constructeur_client.get(reverse('build-exceptions'))
        assert exceptions_response.status_code == 200
        open_reserve_ids = {row['reserve_id'] for row in exceptions_response.data['reserves_ouvertes']}
        assert str(reserve_id) not in open_reserve_ids, (
            'La réserve levée apparaît encore dans "réserves ouvertes" côté BUILD — '
            'incohérence avec apps.inspections.services.OPEN_RESERVE_STATUSES.'
        )
        planned_control_declaration_ids = {
            row['work_declaration_id'] for row in exceptions_response.data['controles_a_planifier']
        }
        assert declaration_id not in planned_control_declaration_ids

        all_lots_response = constructeur_client.get(reverse('build-lots'))
        assert all_lots_response.status_code == 200
        build_row = next(row for row in all_lots_response.data['results'] if row['id'] == str(lot.id))
        assert build_row['open_reserve_count'] == 0

        # Constat DÉLIBÉRÉ, pas un bug : BUILD calcule sa propre
        # `progress_percentage` avec une formule volontairement différente
        # et moins précise que HOME (voir apps/build/services.py::
        # build_lot_rows, "approximation... pas la même précision que
        # HOME") — un même lot affiche donc DEUX pourcentages différents
        # selon l'écran. Documenté ici en valeur exacte pour rendre l'écart
        # visible, pas pour le faire échouer.
        build_expected_percentage = round((1 / SENEGAL_MILESTONE_COUNT) * LEVEL_PROGRESS_FRACTION[TrustLevel.DECLARE])
        assert build_row['progress_percentage'] == build_expected_percentage
        assert build_row['progress_percentage'] != overview['progress_percentage'], (
            f"BUILD affiche {build_row['progress_percentage']}% et HOME {overview['progress_percentage']}% "
            'pour le MÊME lot — écart attendu et déjà documenté (formules différentes), signalé ici pour '
            'qu\'il reste visible plutôt que redécouvert en production.'
        )
