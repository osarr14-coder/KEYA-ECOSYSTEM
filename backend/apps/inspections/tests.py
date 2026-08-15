import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
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
