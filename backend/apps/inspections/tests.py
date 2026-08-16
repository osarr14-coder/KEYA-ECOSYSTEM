import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.services import create_work_declaration
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot
from apps.trust.models import TrustEvent

from . import services
from .models import InspectionOutcome, Reserve

PASSWORD = 'strongpass123'


def _register(email, organization_name, role_code='sponsor'):
    """Enregistre un utilisateur via l'API (JWT réel — nécessaire pour que
    `OrganizationScopeMiddleware` résolve `request.organization`), bascule
    son rôle si nécessaire (pas d'endpoint d'invitation, ticket 001 hors
    scope) — même technique que les tickets précédents.
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


def _setup_constructeur_org(email, organization_name):
    """Organisation constructeur complète : Programme→Bien→Lot→Milestone→
    WorkDeclaration, prête à être inspectée.
    """
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


def _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration):
    response = inspecteur_client.post(
        reverse('inspection-list'),
        {
            'organization': str(constructeur_organization.id),
            'work_declaration': str(declaration.id),
            'outcome': InspectionOutcome.AVEC_RESERVE,
            'note': 'Fissure visible en façade',
        },
        format='json',
    )
    assert response.status_code == 201, response.data
    reserve_id = response.data['opened_reserve']
    assert reserve_id is not None
    return reserve_id


@pytest.mark.django_db
class TestIndependenceRule:
    """Ticket 005 — critère d'acceptation : une inspection ne peut être
    créée que par un utilisateur dont l'organisation diffère de celle du
    constructeur du lot concerné.
    """

    def test_inspector_cannot_inspect_a_lot_of_their_own_organization(self):
        client, organization, _user, _lot, declaration = _setup_constructeur_org(
            'indep-same-org@example.com', 'Org Indep Same',
        )
        # Le même utilisateur/organisation joue aussi le rôle inspecteur —
        # exactement le cas que la règle d'indépendance doit interdire.
        role, _ = Role.objects.get_or_create(code='inspecteur', defaults={'label': 'Inspecteur'})
        user = User.objects.get(email='indep-same-org@example.com')
        set_rls_context(user_id=user.id, organization_id=organization.id)
        Membership.objects.filter(user=user, organization=organization).update(role=role)

        response = client.post(
            reverse('inspection-list'),
            {
                'organization': str(organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
            },
            format='json',
        )

        assert response.status_code == 403

    def test_inspector_can_inspect_a_lot_of_a_different_organization(self):
        _constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'indep-diff-constructeur@example.com', 'Org Indep Diff Constructeur',
        )
        inspecteur_client, _inspecteur_organization, _i_user = _setup_inspecteur(
            'indep-diff-inspecteur@example.com', 'Org Indep Diff Inspecteur',
        )

        response = inspecteur_client.post(
            reverse('inspection-list'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
            },
            format='json',
        )

        assert response.status_code == 201

    def test_nonexistent_target_organization_is_rejected(self):
        inspecteur_client, _organization, _user = _setup_inspecteur(
            'indep-badorg@example.com', 'Org Indep Bad Org',
        )
        response = inspecteur_client.post(
            reverse('inspection-list'),
            {
                'organization': '00000000-0000-0000-0000-000000000000',
                'work_declaration': '00000000-0000-0000-0000-000000000001',
                'outcome': InspectionOutcome.CONFORME,
            },
            format='json',
        )
        assert response.status_code == 400


@pytest.mark.django_db
class TestConstructeurCannotChangeReserveStatus:
    """Ticket 005 — critère d'acceptation le plus important de ce ticket :
    un utilisateur avec rôle constructeur ne peut appeler AUCUN endpoint
    qui changerait directement le statut d'une réserve. Testé comme une
    tentative explicite refusée (403/405), jamais comme une simple absence
    de bouton côté UI.
    """

    def _setup_open_reserve(self, suffix):
        constructeur_client, constructeur_organization, _c_user, _lot, declaration = _setup_constructeur_org(
            f'reservestatus-constructeur-{suffix}@example.com', f'Org Reserve Status Constructeur {suffix}',
        )
        inspecteur_client, _inspecteur_organization, _i_user = _setup_inspecteur(
            f'reservestatus-inspecteur-{suffix}@example.com', f'Org Reserve Status Inspecteur {suffix}',
        )
        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)
        return constructeur_client, constructeur_organization, declaration, reserve_id

    def test_constructeur_cannot_create_any_inspection(self):
        constructeur_client, constructeur_organization, declaration, _reserve_id = self._setup_open_reserve('a')

        response = constructeur_client.post(
            reverse('inspection-list'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
            },
            format='json',
        )

        assert response.status_code == 403

    def test_constructeur_cannot_simulate_a_follow_up_inspection_to_lift_the_reserve(self):
        constructeur_client, constructeur_organization, declaration, reserve_id = self._setup_open_reserve('b')

        response = constructeur_client.post(
            reverse('inspection-list'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
                'reserve': str(reserve_id),
            },
            format='json',
        )

        assert response.status_code == 403
        # Le statut n'a pas bougé : toujours "ouverte", accessible en
        # lecture par le constructeur (même organisation que la réserve).
        status_response = constructeur_client.get(reverse('reserve-detail', args=[reserve_id]))
        assert status_response.data['status'] == 'ouverte'

    def test_patch_on_reserve_endpoint_is_not_a_valid_method(self):
        constructeur_client, _organization, _declaration, reserve_id = self._setup_open_reserve('c')

        response = constructeur_client.patch(
            reverse('reserve-detail', args=[reserve_id]), {'status': 'levee'}, format='json',
        )

        assert response.status_code == 405

    def test_reserve_correction_endpoint_never_accepts_a_status_field(self):
        """Le constructeur PEUT documenter une correction — mais cette
        action (`ReserveCorrectionCreateSerializer`) n'accepte aucun champ
        `status` en entrée : `correction_proposee` est une conséquence fixe
        de la création, jamais un choix du client.
        """
        from .serializers import ReserveCorrectionCreateSerializer

        fields = ReserveCorrectionCreateSerializer().fields
        assert 'status' not in fields
        assert set(fields.keys()) == {'reserve', 'evidence'}


@pytest.mark.django_db
class TestFullReserveHistoryIsReadableAfterLevee:
    """Ticket 005 — critère d'acceptation : l'historique complet d'une
    réserve (ouverte → corrigée → re-inspectée → levée) reste consultable
    en entier après la levée, rien n'est écrasé.
    """

    def test_full_lifecycle_produces_four_readable_events_none_overwritten(self):
        constructeur_client, constructeur_organization, c_user, _lot, declaration = _setup_constructeur_org(
            'lifecycle-constructeur@example.com', 'Org Lifecycle Constructeur',
        )
        inspecteur_client, _inspecteur_organization, i_user = _setup_inspecteur(
            'lifecycle-inspecteur@example.com', 'Org Lifecycle Inspecteur',
        )

        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        # Le constructeur documente une correction (upload d'une preuve,
        # puis rattachement à la réserve).
        set_rls_context(user_id=c_user.id, organization_id=constructeur_organization.id)
        buffer = io.BytesIO()
        Image.new('RGB', (10, 10), (0, 255, 0)).save(buffer, format='JPEG')
        buffer.seek(0)
        image_file = SimpleUploadedFile('correction.jpg', buffer.read(), content_type='image/jpeg')

        document_response = constructeur_client.post(
            reverse('document-list'),
            {'file': image_file, 'category': 'photo_correction', 'source': 'mobile_app_photo'},
            format='multipart',
        )
        assert document_response.status_code == 201

        evidence_response = constructeur_client.post(
            reverse('evidence-list'),
            {'work_declaration': str(declaration.id), 'documents': [document_response.data['id']]},
            format='json',
        )
        assert evidence_response.status_code == 201

        correction_response = constructeur_client.post(
            reverse('reservecorrection-list'),
            {'reserve': reserve_id, 'evidence': evidence_response.data['id']},
            format='json',
        )
        assert correction_response.status_code == 201

        status_after_correction = constructeur_client.get(reverse('reserve-detail', args=[reserve_id])).data['status']
        assert status_after_correction == 'correction_proposee'

        # L'inspecteur mène une nouvelle inspection sur cette même réserve,
        # constate que c'est conforme : la réserve passe à "levee".
        follow_up_response = inspecteur_client.post(
            reverse('inspection-list'),
            {
                'organization': str(constructeur_organization.id),
                'work_declaration': str(declaration.id),
                'outcome': InspectionOutcome.CONFORME,
                'reserve': reserve_id,
            },
            format='json',
        )
        assert follow_up_response.status_code == 201

        set_rls_context(user_id=i_user.id, organization_id=constructeur_organization.id)
        reserve = Reserve.objects.get(id=reserve_id)
        assert services.get_reserve_status(reserve) == 'levee'

        final_status = constructeur_client.get(reverse('reserve-detail', args=[reserve_id])).data['status']
        assert final_status == 'levee'

        events = list(
            TrustEvent.objects.filter(subject_id=reserve_id).order_by('created_at').values_list('source', flat=True),
        )
        assert events == ['ouverte', 'correction_proposee', 'nouvelle_inspection', 'levee']

        # Rien n'a été écrasé : l'événement "ouverte" original existe
        # toujours, avec son acteur et sa date d'origine.
        opening_event = TrustEvent.objects.get(subject_id=reserve_id, source='ouverte')
        assert opening_event.actor_id == i_user.id


@pytest.mark.django_db
class TestInspectionsAppIsOrganizationScoped:
    """Couverture RLS pour Inspection/Reserve/ReserveCorrection — chaque
    table a sa propre policy, chacune est prouvée séparément (suivant le
    pattern des tickets précédents : un bug isolé sur l'une ne serait pas
    détecté en n'en testant qu'une seule).
    """

    def _setup_chain(self):
        constructeur_client, constructeur_organization, c_user, _lot, declaration = _setup_constructeur_org(
            'scoped-constructeur@example.com', 'Org Scoped Constructeur',
        )
        inspecteur_client, _inspecteur_organization, _i_user = _setup_inspecteur(
            'scoped-inspecteur@example.com', 'Org Scoped Inspecteur',
        )
        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        set_rls_context(user_id=c_user.id, organization_id=constructeur_organization.id)
        reserve = Reserve.objects.get(id=reserve_id)
        inspection_id = reserve.opened_by_inspection_id

        outsider_client, _outsider_organization, _o_user = _register(
            'scoped-outsider@example.com', 'Org Scoped Outsider',
        )
        return outsider_client, reserve_id, inspection_id

    def test_reserve_of_another_organization_is_not_visible(self):
        outsider_client, reserve_id, _inspection_id = self._setup_chain()
        response = outsider_client.get(reverse('reserve-detail', args=[reserve_id]))
        assert response.status_code == 404

    def test_inspection_of_another_organization_is_not_visible(self):
        outsider_client, _reserve_id, inspection_id = self._setup_chain()
        response = outsider_client.get(reverse('inspection-detail', args=[inspection_id]))
        assert response.status_code == 404


@pytest.mark.django_db
class TestCreateMissionIndependenceRule:
    """Ticket 012 — la règle d'indépendance du contrôle (V3.0 §2.3) est
    revalidée À L'AFFECTATION, pas seulement à l'inspection elle-même
    (`create_inspection`) : critère d'acceptation explicite du ticket.
    """

    def test_rejects_when_assigned_inspector_also_belongs_to_the_target_organization(self):
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'mission-indep-constructeur@example.com', 'Org Mission Indep Constructeur',
        )
        _inspecteur_client, _inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'mission-indep-inspecteur@example.com', 'Org Mission Indep Inspecteur',
        )
        # L'inspecteur devient AUSSI membre de l'organisation cible — exactement
        # le cas que la règle d'indépendance doit interdire, même s'il détient
        # par ailleurs le rôle inspecteur ailleurs.
        extra_role, _ = Role.objects.get_or_create(code='sponsor', defaults={'label': 'Sponsor'})
        set_rls_context(organization_id=organization.id)
        Membership.objects.create(user=inspecteur_user, organization=organization, role=extra_role)

        _admin_client, admin_org, admin_user = _register_admin(
            'mission-indep-admin@example.com', 'Org Mission Indep Admin',
        )

        with pytest.raises(services.IndependenceRuleViolation):
            services.create_mission(
                assigned_by=admin_user, assigned_by_organization_id=admin_org.id,
                target_organization_id=organization.id, work_declaration_id=declaration.id,
                assigned_inspector=inspecteur_user,
            )

    def test_rejects_when_assigned_user_has_no_inspecteur_role_anywhere(self):
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'mission-notinspector-constructeur@example.com', 'Org Mission NotInspector Constructeur',
        )
        _other_client, _other_org, other_user = _register(
            'mission-notinspector-other@example.com', 'Org Mission NotInspector Other',
        )
        _admin_client, admin_org, admin_user = _register_admin(
            'mission-notinspector-admin@example.com', 'Org Mission NotInspector Admin',
        )

        with pytest.raises(services.NotAnInspectorError):
            services.create_mission(
                assigned_by=admin_user, assigned_by_organization_id=admin_org.id,
                target_organization_id=organization.id, work_declaration_id=declaration.id,
                assigned_inspector=other_user,
            )

    def test_succeeds_for_a_genuinely_independent_inspector_and_notifies_via_task_not_trustevent(self):
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'mission-success-constructeur@example.com', 'Org Mission Success Constructeur',
        )
        _inspecteur_client, _inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'mission-success-inspecteur@example.com', 'Org Mission Success Inspecteur',
        )
        _admin_client, admin_org, admin_user = _register_admin(
            'mission-success-admin@example.com', 'Org Mission Success Admin',
        )

        mission = services.create_mission(
            assigned_by=admin_user, assigned_by_organization_id=admin_org.id,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            assigned_inspector=inspecteur_user,
        )
        assert mission.organization_id == organization.id
        assert mission.assigned_inspector_id == inspecteur_user.id
        assert mission.assigned_by_id == admin_user.id

        # Effet de bord : une Task de notification (ticket 006), JAMAIS un
        # TrustEvent — une mission n'affirme aucune confiance sur son sujet
        # (doctrine Visible Trust, voir InspectionMission).
        set_rls_context(organization_id=organization.id)
        from apps.tasks.models import Task

        task = Task.objects.get(subject_id=mission.id)
        assert task.assignee_id == inspecteur_user.id
        assert task.source == 'mission_assigned'
        assert inspecteur_user.email in task.label

        assert not TrustEvent.objects.filter(subject_id=mission.id).exists()


@pytest.mark.django_db
class TestInspectionMissionRLS:
    """Ticket 012 — la policy RLS de `inspections_mission` autorise
    `assigned_inspector_id = current_user` EN PLUS de `organization_id =
    current_org` : une comparaison de COLONNE, jamais une sous-requête sur
    cette même table (voir migration 0006, leçon du ticket 011 — récursion
    infinie détectée par Postgres sous FORCE ROW LEVEL SECURITY pour un
    pattern différent). Vérifié en SQL brut, pas seulement via l'API.
    """

    def _setup_mission(self, suffix):
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            f'mission-rls-constructeur-{suffix}@example.com', f'Org Mission RLS Constructeur {suffix}',
        )
        _inspecteur_client, inspecteur_organization, inspecteur_user = _setup_inspecteur(
            f'mission-rls-inspecteur-{suffix}@example.com', f'Org Mission RLS Inspecteur {suffix}',
        )
        _admin_client, admin_org, admin_user = _register_admin(
            f'mission-rls-admin-{suffix}@example.com', f'Org Mission RLS Admin {suffix}',
        )
        mission = services.create_mission(
            assigned_by=admin_user, assigned_by_organization_id=admin_org.id,
            target_organization_id=organization.id, work_declaration_id=declaration.id,
            assigned_inspector=inspecteur_user,
        )
        return organization, inspecteur_organization, inspecteur_user, mission

    def test_assigned_inspector_can_read_their_own_mission_via_column_comparison(self):
        _organization, inspecteur_organization, inspecteur_user, mission = self._setup_mission('select')

        # Contexte de l'inspecteur : SA PROPRE organisation active, JAMAIS
        # celle du lot inspecté par construction — seule la comparaison
        # `assigned_inspector_id = current_user` peut rendre cette ligne
        # visible ici.
        set_rls_context(user_id=inspecteur_user.id, organization_id=inspecteur_organization.id)
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM inspections_mission WHERE id = %s', [str(mission.id)])
            rows = cursor.fetchall()
        assert len(rows) == 1

    def test_a_genuine_outsider_cannot_read_the_mission(self):
        _organization, _inspecteur_organization, _inspecteur_user, mission = self._setup_mission('outsider')
        _outsider_client, outsider_organization, outsider_user = _register(
            'mission-rls-outsider@example.com', 'Org Mission RLS Outsider',
        )
        set_rls_context(user_id=outsider_user.id, organization_id=outsider_organization.id)
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM inspections_mission WHERE id = %s', [str(mission.id)])
            rows = cursor.fetchall()
        assert rows == []

    def test_insert_still_requires_the_target_organization_as_active_context(self):
        """L'élargissement ne touche QUE le SELECT (voir migration 0006) —
        l'INSERT garde sa policy stricte, inchangée : même admin_keyimmo ne
        peut écrire qu'en empruntant explicitement le contexte de
        l'organisation cible (voir `create_mission`), jamais par un
        élargissement de la policy d'écriture elle-même.
        """
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'mission-rls-insert-constructeur@example.com', 'Org Mission RLS Insert Constructeur',
        )
        _inspecteur_client, _inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'mission-rls-insert-inspecteur@example.com', 'Org Mission RLS Insert Inspecteur',
        )
        _admin_client, admin_org, admin_user = _register_admin(
            'mission-rls-insert-admin@example.com', 'Org Mission RLS Insert Admin',
        )

        import uuid

        from django.db.utils import ProgrammingError

        # Contexte de l'admin, PAS celui de l'organisation cible — tentative
        # d'insertion directe en SQL brut, contournant complètement
        # `create_mission`.
        set_rls_context(user_id=admin_user.id, organization_id=admin_org.id)
        with pytest.raises(ProgrammingError):
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO inspections_mission
                        (id, organization_id, work_declaration_id, assigned_inspector_id, assigned_by_id, created_at)
                    VALUES (%s, %s, %s, %s, %s, now())
                    """,
                    [
                        str(uuid.uuid4()), str(organization.id), str(declaration.id),
                        str(inspecteur_user.id), str(admin_user.id),
                    ],
                )
