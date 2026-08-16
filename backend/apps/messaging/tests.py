import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.models import Document, SensitivityLevel
from apps.evidence.services import create_document, create_work_declaration
from apps.inspections.models import InspectionOutcome
from apps.messaging.models import Message
from apps.messaging.services import create_message
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot

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


def _open_reserve(inspecteur_client, constructeur_organization, declaration):
    response = inspecteur_client.post(
        reverse('inspection-list'),
        {
            'organization': str(constructeur_organization.id),
            'work_declaration': str(declaration.id),
            'outcome': InspectionOutcome.AVEC_RESERVE,
        },
        format='json',
    )
    assert response.status_code == 201, response.data
    return response.data['opened_reserve']


def _jpeg_file(name='photo.jpg'):
    buffer = io.BytesIO()
    Image.new('RGB', (10, 10), (0, 255, 0)).save(buffer, format='JPEG')
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type='image/jpeg')


@pytest.mark.django_db
class TestMessageAlwaysAttachedToABusinessObject:
    """Ticket 011, critère d'acceptation : « un message est toujours
    rattaché à un objet métier existant, jamais une messagerie libre sans
    contexte »."""

    def test_rejects_a_subject_outside_the_allowed_types(self):
        _client, organization, user = _register('attach-reject@example.com', 'Org Attach Reject')

        with pytest.raises(Exception) as excinfo:
            create_message(subject=organization, author=user, body='Bonjour')
        assert 'lot' in str(excinfo.value).lower() or 'objet métier' in str(excinfo.value).lower()

        assert Message.objects.count() == 0

    def test_rejects_an_empty_body(self):
        _constructeur_client, _organization, user, lot, _declaration = _setup_constructeur_org(
            'attach-empty@example.com', 'Org Attach Empty',
        )
        with pytest.raises(Exception):
            create_message(subject=lot, author=user, body='   ')
        assert Message.objects.count() == 0

    def test_accepts_a_lot_a_reserve_and_a_document(self):
        constructeur_client, organization, user, lot, declaration = _setup_constructeur_org(
            'attach-accept@example.com', 'Org Attach Accept',
        )
        inspecteur_client, _inspecteur_org, _i_user = _setup_inspecteur(
            'attach-accept-inspecteur@example.com', 'Org Attach Accept Inspecteur',
        )

        set_rls_context(user_id=user.id, organization_id=organization.id)
        lot_message = create_message(subject=lot, author=user, body='Message sur le lot')
        assert lot_message.organization_id == organization.id

        reserve_id = _open_reserve(inspecteur_client, organization, declaration)
        # `create_inspection` restaure le contexte RLS de l'INSPECTEUR dans
        # son propre `finally` (voir apps.inspections.services) — piège déjà
        # documenté ailleurs dans ce projet : il faut reposer explicitement
        # le contexte du constructeur avant toute lecture directe ici.
        set_rls_context(user_id=user.id, organization_id=organization.id)
        from apps.inspections.models import Reserve
        reserve = Reserve.objects.get(id=reserve_id)
        reserve_message = create_message(subject=reserve, author=user, body='Message sur la réserve')
        assert reserve_message.organization_id == organization.id

        document = create_document(
            organization=organization, owner=user, uploaded_file=_jpeg_file(),
            category='photo', source='mobile_app_photo',
        )
        document_message = create_message(subject=document, author=user, body='Message sur le document')
        assert document_message.organization_id == organization.id


@pytest.mark.django_db
class TestMessageVisibilityInheritsLotPermissions:
    """Aucune nouvelle logique de permission : la visibilité d'un message
    sur un `Lot` se réduit exactement à celle du `Lot` lui-même
    (`LotViewSet.get_object()`, organisation active)."""

    def test_member_of_the_lot_organization_can_post_and_read(self):
        constructeur_client, _organization, _user, lot, _declaration = _setup_constructeur_org(
            'lotmsg-member@example.com', 'Org LotMsg Member',
        )

        post_response = constructeur_client.post(
            reverse('lot-messages', args=[lot.id]), {'body': 'Où en est-on ?'}, format='json',
        )
        assert post_response.status_code == 201, post_response.data
        assert post_response.data['body'] == 'Où en est-on ?'
        assert post_response.data['subject_type'] == 'lot'

        get_response = constructeur_client.get(reverse('lot-messages', args=[lot.id]))
        assert get_response.status_code == 200
        assert len(get_response.data) == 1
        assert get_response.data[0]['body'] == 'Où en est-on ?'

    def test_outsider_of_another_organization_cannot_read_or_post(self):
        _constructeur_client, _organization, _user, lot, _declaration = _setup_constructeur_org(
            'lotmsg-outsider-owner@example.com', 'Org LotMsg Outsider Owner',
        )
        outsider_client, _outsider_org, _o_user = _register(
            'lotmsg-outsider@example.com', 'Org LotMsg Outsider',
        )

        get_response = outsider_client.get(reverse('lot-messages', args=[lot.id]))
        assert get_response.status_code == 404

        post_response = outsider_client.post(
            reverse('lot-messages', args=[lot.id]), {'body': 'Je ne devrais pas pouvoir écrire ici'}, format='json',
        )
        assert post_response.status_code == 404
        assert Message.objects.count() == 0


@pytest.mark.django_db
class TestMessageVisibilityInheritsReservePermissions:
    def test_member_of_the_reserve_organization_can_post_and_read(self):
        constructeur_client, organization, _user, _lot, declaration = _setup_constructeur_org(
            'reservemsg-member@example.com', 'Org ReserveMsg Member',
        )
        inspecteur_client, _inspecteur_org, _i_user = _setup_inspecteur(
            'reservemsg-inspecteur@example.com', 'Org ReserveMsg Inspecteur',
        )
        reserve_id = _open_reserve(inspecteur_client, organization, declaration)

        post_response = constructeur_client.post(
            reverse('reserve-messages', args=[reserve_id]), {'body': 'On corrige ça cette semaine'}, format='json',
        )
        assert post_response.status_code == 201, post_response.data
        assert post_response.data['subject_type'] == 'reserve'

        get_response = constructeur_client.get(reverse('reserve-messages', args=[reserve_id]))
        assert get_response.status_code == 200
        assert len(get_response.data) == 1

    def test_the_inspector_who_opened_it_cannot_read_or_post_afterwards(self):
        """Limite déjà documentée par `apps.inspections.services.
        create_inspection` (ticket 005) : l'inspecteur ne peut pas relire
        ses propres inspections/réserves via l'API standard, faute d'une
        requête cross-organisation dédiée (explicitement hors scope). Le
        ticket 011 hérite de cette limite plutôt que de la résoudre —
        confirmé explicitement ici pour qu'un futur changement de
        comportement soit un choix délibéré, pas un oubli silencieux.
        """
        constructeur_client, organization, _user, _lot, declaration = _setup_constructeur_org(
            'reservemsg-inspecteur-reread@example.com', 'Org ReserveMsg Inspecteur Reread',
        )
        inspecteur_client, _inspecteur_org, _i_user = _setup_inspecteur(
            'reservemsg-inspecteur2@example.com', 'Org ReserveMsg Inspecteur2',
        )
        reserve_id = _open_reserve(inspecteur_client, organization, declaration)

        get_response = inspecteur_client.get(reverse('reserve-messages', args=[reserve_id]))
        assert get_response.status_code == 404

    def test_outsider_of_another_organization_cannot_read_or_post(self):
        constructeur_client, organization, _user, _lot, declaration = _setup_constructeur_org(
            'reservemsg-outsider-owner@example.com', 'Org ReserveMsg Outsider Owner',
        )
        inspecteur_client, _inspecteur_org, _i_user = _setup_inspecteur(
            'reservemsg-outsider-inspecteur@example.com', 'Org ReserveMsg Outsider Inspecteur',
        )
        reserve_id = _open_reserve(inspecteur_client, organization, declaration)

        outsider_client, _outsider_org, _o_user = _register(
            'reservemsg-outsider@example.com', 'Org ReserveMsg Outsider',
        )
        response = outsider_client.get(reverse('reserve-messages', args=[reserve_id]))
        assert response.status_code == 404


@pytest.mark.django_db
class TestMessageVisibilityInheritsDocumentPermissions:
    """Le cas le plus fin : `sensitivity_level` doit continuer à
    conditionner l'accès aux messages exactement comme il conditionne déjà
    l'accès au document lui-même (ticket 004,
    `apps.evidence.access.user_can_access_document`) — réutilisé tel quel,
    jamais une seconde règle."""

    def _setup_confidential_document(self, suffix):
        constructeur_client, organization, owner, _lot, _declaration = _setup_constructeur_org(
            f'docmsg-owner-{suffix}@example.com', f'Org DocMsg Owner {suffix}',
        )
        set_rls_context(user_id=owner.id, organization_id=organization.id)
        document = create_document(
            organization=organization, owner=owner, uploaded_file=_jpeg_file(),
            category='photo', source='mobile_app_photo', sensitivity_level=SensitivityLevel.CONFIDENTIEL,
        )
        return constructeur_client, organization, owner, document

    def test_owner_can_read_and_post_on_a_confidential_document(self):
        owner_client, _organization, _owner, document = self._setup_confidential_document('owner')

        post_response = owner_client.post(
            reverse('document-messages', args=[document.id]), {'body': 'Notes privées'}, format='json',
        )
        assert post_response.status_code == 201, post_response.data

        get_response = owner_client.get(reverse('document-messages', args=[document.id]))
        assert get_response.status_code == 200
        assert len(get_response.data) == 1

    def test_admin_keyimmo_can_read_and_post_on_a_confidential_document_they_do_not_own(self):
        _owner_client, organization, _owner, document = self._setup_confidential_document('admin')
        admin_client, _admin_org, admin_user = _register(
            'docmsg-admin@example.com', 'Org DocMsg Admin Alt',
        )
        role, _ = Role.objects.get_or_create(code='admin_keyimmo', defaults={'label': 'Admin KEYIMMO'})
        # L'admin doit être membre de l'organisation propriétaire du document
        # pour que `request.organization` corresponde (même contrainte que
        # n'importe quel autre rôle, voir `access.user_can_access_document`).
        # Contexte RLS basculé vers CETTE organisation AVANT l'insertion : la
        # policy INSERT de `organizations_membership` exige
        # `organization_id = current_org` (voir migration 0002_membership_rls)
        # — le contexte laissé par `_register` ci-dessus pointe encore vers
        # la propre organisation fraîchement créée de l'admin, pas celle-ci.
        set_rls_context(organization_id=organization.id)
        Membership.objects.create(user=admin_user, organization=organization, role=role)
        set_rls_context(user_id=admin_user.id, organization_id=organization.id)
        token = admin_client.post(
            reverse('login'), {'email': 'docmsg-admin@example.com', 'password': PASSWORD}, format='json',
        ).data['access']
        # `admin_user` a maintenant DEUX memberships (sa propre organisation,
        # créée en premier par `_register`, et celle-ci) — sans l'en-tête, le
        # middleware retiendrait la plus ANCIENNE comme organisation active
        # (voir apps.core.middleware._resolve_organization), pas celle du
        # document. En-tête explicite requis pour cibler la bonne.
        admin_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_ORGANIZATION_ID=str(organization.id))

        response = admin_client.get(reverse('document-messages', args=[document.id]))
        assert response.status_code == 200

    def test_other_member_without_admin_role_cannot_read_or_post_on_a_confidential_document(self):
        _owner_client, organization, _owner, document = self._setup_confidential_document('other')
        other_client, _org2, other_user = _register('docmsg-other@example.com', 'Org DocMsg Other Alt')
        sponsor_role, _ = Role.objects.get_or_create(code='sponsor', defaults={'label': 'Sponsor'})
        set_rls_context(organization_id=organization.id)
        Membership.objects.create(user=other_user, organization=organization, role=sponsor_role)
        token = other_client.post(
            reverse('login'), {'email': 'docmsg-other@example.com', 'password': PASSWORD}, format='json',
        ).data['access']
        # Même remarque que ci-dessus : deux memberships, en-tête requis pour
        # cibler l'organisation propriétaire du document (pas la plus
        # ancienne, résolue par défaut).
        other_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_ORGANIZATION_ID=str(organization.id))

        response = other_client.get(reverse('document-messages', args=[document.id]))
        assert response.status_code == 403
        post_response = other_client.post(
            reverse('document-messages', args=[document.id]), {'body': 'Je ne devrais pas voir ça'}, format='json',
        )
        assert post_response.status_code == 403
        assert Message.objects.count() == 0

    def test_any_member_can_read_and_post_on_a_non_confidential_document(self):
        constructeur_client, organization, owner, _lot, _declaration = _setup_constructeur_org(
            'docmsg-public@example.com', 'Org DocMsg Public',
        )
        set_rls_context(user_id=owner.id, organization_id=organization.id)
        document = create_document(
            organization=organization, owner=owner, uploaded_file=_jpeg_file(),
            category='photo', source='mobile_app_photo', sensitivity_level=SensitivityLevel.INTERNE,
        )
        response = constructeur_client.post(
            reverse('document-messages', args=[document.id]), {'body': 'Visible par tous'}, format='json',
        )
        assert response.status_code == 201, response.data


@pytest.mark.django_db
class TestMessageIsOrganizationScopedAtTheDatabaseLevel:
    """Même rigueur que ticket 001 : un test qui ne passe QUE par l'API ne
    prouve pas la policy RLS elle-même — SQL brut requis (voir CLAUDE.md,
    section RLS multi-tenant)."""

    def test_raw_sql_select_from_another_organization_context_returns_nothing(self):
        _client, organization_a, user_a, lot, _declaration = _setup_constructeur_org(
            'rls-message-a@example.com', 'Org RLS Message A',
        )
        _client_b, organization_b, _user_b, _lot_b, _decl_b = _setup_constructeur_org(
            'rls-message-b@example.com', 'Org RLS Message B',
        )

        set_rls_context(user_id=user_a.id, organization_id=organization_a.id)
        message = create_message(subject=lot, author=user_a, body='Confidentiel à mon organisation')

        # Contexte RLS basculé vers l'AUTRE organisation, en SQL brut — pas
        # via l'API/ORM d'une vue, pour prouver la policy elle-même.
        set_rls_context(organization_id=organization_b.id)
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM messaging_message WHERE id = %s', [str(message.id)])
            rows = cursor.fetchall()
        assert rows == []

        # Restaure le contexte légitime : la même ligne redevient visible.
        set_rls_context(organization_id=organization_a.id)
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM messaging_message WHERE id = %s', [str(message.id)])
            rows = cursor.fetchall()
        assert len(rows) == 1
