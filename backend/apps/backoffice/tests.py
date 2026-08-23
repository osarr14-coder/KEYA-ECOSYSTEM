import inspect

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.services import create_work_declaration
from apps.messaging.services import create_message
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot
from apps.trust import repository as trust_repository
from apps.trust.models import TrustEvent, TrustLevel

PASSWORD = 'strongpass123'


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


def _register_admin(email, organization_name):
    return _register(email, organization_name, role_code='admin_keyimmo')


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


@pytest.mark.django_db
class TestBackofficeAccessIsReservedToAdminKeyimmo:
    def test_non_admin_is_rejected_from_all_three_endpoints(self):
        client, _organization, user = _register('backoffice-nonadmin@example.com', 'Org Backoffice NonAdmin')

        assert client.get(reverse('backoffice-user-search') + '?q=a').status_code == 403
        assert client.get(reverse('backoffice-user-detail', args=[user.id])).status_code == 403
        assert client.post(reverse('backoffice-user-deactivate', args=[user.id])).status_code == 403

    def test_admin_keyimmo_is_accepted(self):
        admin_client, _organization, admin_user = _register_admin(
            'backoffice-admin-access@example.com', 'Org Backoffice Admin Access',
        )
        response = admin_client.get(reverse('backoffice-user-detail', args=[admin_user.id]))
        assert response.status_code == 200

    def test_unauthenticated_request_is_rejected(self):
        anonymous_client = APIClient()
        response = anonymous_client.get(reverse('backoffice-user-search') + '?q=a')
        assert response.status_code in (401, 403)


@pytest.mark.django_db
class TestMissionCreationIsReservedToAdminKeyimmo:
    """Ticket 012 — critère d'acceptation : seul un membre `admin_keyimmo`
    peut créer une affectation, testé comme une tentative explicite refusée
    pour tout autre rôle, pas une simple absence de bouton côté UI.
    """

    def test_non_admin_cannot_create_a_mission(self):
        constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'mission-perm-constructeur@example.com', 'Org Mission Perm Constructeur',
        )
        _inspecteur_client, _inspecteur_org, inspecteur_user = _setup_inspecteur(
            'mission-perm-inspecteur@example.com', 'Org Mission Perm Inspecteur',
        )

        response = constructeur_client.post(
            reverse('backoffice-mission-create'),
            {
                'organization': str(organization.id),
                'work_declaration': str(declaration.id),
                'assigned_inspector': str(inspecteur_user.id),
            },
            format='json',
        )
        assert response.status_code == 403

    def test_admin_keyimmo_can_create_a_mission(self):
        admin_client, admin_org, _admin_user = _register_admin(
            'mission-perm-admin@example.com', 'Org Mission Perm Admin',
        )
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'mission-perm-admin-constructeur@example.com', 'Org Mission Perm Admin Constructeur',
        )
        _inspecteur_client, _inspecteur_org, inspecteur_user = _setup_inspecteur(
            'mission-perm-admin-inspecteur@example.com', 'Org Mission Perm Admin Inspecteur',
        )

        response = admin_client.post(
            reverse('backoffice-mission-create'),
            {
                'organization': str(organization.id),
                'work_declaration': str(declaration.id),
                'assigned_inspector': str(inspecteur_user.id),
            },
            format='json',
        )
        assert response.status_code == 201, response.data
        assert response.data['organization'] == str(organization.id)
        assert response.data['assigned_inspector'] == str(inspecteur_user.id)

    def test_independence_violation_is_rejected_through_the_full_endpoint(self):
        """Pas seulement testé au niveau service (voir apps/inspections/
        tests.py) — la chaîne complète vue→service→exception→403 doit
        fonctionner de bout en bout.
        """
        admin_client, admin_org, _admin_user = _register_admin(
            'mission-perm-indep-admin@example.com', 'Org Mission Perm Indep Admin',
        )
        _constructeur_client, organization, _c_user, _lot, declaration = _setup_constructeur_org(
            'mission-perm-indep-constructeur@example.com', 'Org Mission Perm Indep Constructeur',
        )
        _inspecteur_client, _inspecteur_org, inspecteur_user = _setup_inspecteur(
            'mission-perm-indep-inspecteur@example.com', 'Org Mission Perm Indep Inspecteur',
        )
        extra_role, _ = Role.objects.get_or_create(code='sponsor', defaults={'label': 'Sponsor'})
        set_rls_context(organization_id=organization.id)
        Membership.objects.create(user=inspecteur_user, organization=organization, role=extra_role)

        response = admin_client.post(
            reverse('backoffice-mission-create'),
            {
                'organization': str(organization.id),
                'work_declaration': str(declaration.id),
                'assigned_inspector': str(inspecteur_user.id),
            },
            format='json',
        )
        assert response.status_code == 403

        from apps.inspections.models import InspectionMission
        set_rls_context(organization_id=organization.id)
        assert not InspectionMission.objects.filter(work_declaration=declaration).exists()


@pytest.mark.django_db
class TestUserSearch:
    def test_finds_a_user_by_partial_email(self):
        admin_client, _organization, _admin_user = _register_admin(
            'backoffice-search-admin@example.com', 'Org Backoffice Search Admin',
        )
        _client, _org2, _user2 = _register('findme-target@example.com', 'Org Backoffice Search Target')

        response = admin_client.get(reverse('backoffice-user-search') + '?q=findme')
        assert response.status_code == 200
        emails = [row['email'] for row in response.data]
        assert 'findme-target@example.com' in emails

    def test_empty_query_returns_no_results_rather_than_a_full_dump(self):
        admin_client, _organization, _admin_user = _register_admin(
            'backoffice-search-empty-admin@example.com', 'Org Backoffice Search Empty Admin',
        )
        _client, _org2, _user2 = _register('someone-else@example.com', 'Org Backoffice Search Empty Other')

        response = admin_client.get(reverse('backoffice-user-search'))
        assert response.status_code == 200
        assert response.data == []


@pytest.mark.django_db
class TestUserDetailShowsOrganizationAndRole:
    def test_shows_the_organization_and_role_of_a_user_in_an_organization_the_admin_does_not_belong_to(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'backoffice-detail-admin@example.com', 'Org Backoffice Detail Admin',
        )
        _target_client, target_organization, target_user = _register(
            'backoffice-detail-target@example.com', 'Org Backoffice Detail Target', role_code='constructeur',
        )

        response = admin_client.get(reverse('backoffice-user-detail', args=[target_user.id]))

        assert response.status_code == 200
        assert response.data['user']['email'] == 'backoffice-detail-target@example.com'
        assert len(response.data['memberships']) == 1
        # `UUIDField.to_representation` renvoie une chaîne — comparer à
        # `target_organization.id` (un vrai `UUID`) tel quel aurait échoué,
        # même piège déjà rencontré ailleurs dans ce projet.
        assert response.data['memberships'][0]['organization_id'] == str(target_organization.id)
        assert response.data['memberships'][0]['role'] == 'constructeur'

    def test_unknown_user_returns_404(self):
        admin_client, _organization, _admin_user = _register_admin(
            'backoffice-detail-404-admin@example.com', 'Org Backoffice Detail 404 Admin',
        )
        response = admin_client.get(
            reverse('backoffice-user-detail', args=['00000000-0000-0000-0000-000000000000']),
        )
        assert response.status_code == 404


@pytest.mark.django_db
class TestDeactivateUserBlocksAccessImmediatelyWithoutDeletingData:
    """Ticket 011, critère d'acceptation central : désactiver un compte
    bloque l'accès IMMÉDIATEMENT sans supprimer aucune donnée historique.
    """

    def _setup_target_with_history(self, suffix):
        """Un utilisateur cible avec un historique réel : un TrustEvent
        (via une déclaration de travaux), un message, dont on va vérifier
        qu'ils survivent intacts à la désactivation."""
        target_client, organization, target_user = _register(
            f'backoffice-deactivate-{suffix}@example.com', f'Org Backoffice Deactivate {suffix}',
            role_code='constructeur',
        )
        program = Program.objects.create(organization=organization, name='Programme')
        asset = Asset.objects.create(organization=organization, program=program, name='Bien')
        lot = Lot.objects.create(organization=organization, asset=asset, name='Lot')
        instantiate_milestones_for_lot(lot)
        milestone = lot.milestones.first()
        declaration = create_work_declaration(organization=organization, milestone=milestone, declared_by=target_user)
        message = create_message(subject=lot, author=target_user, body='Message avant désactivation')
        return target_client, organization, target_user, declaration, message

    def test_deactivation_sets_is_active_false_and_nothing_else(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'backoffice-deactivate-admin@example.com', 'Org Backoffice Deactivate Admin',
        )
        _target_client, _organization, target_user, _decl, _msg = self._setup_target_with_history('basic')

        response = admin_client.post(reverse('backoffice-user-deactivate', args=[target_user.id]))
        assert response.status_code == 200
        assert response.data['is_active'] is False

        target_user.refresh_from_db()
        assert target_user.is_active is False

    def test_an_already_issued_jwt_stops_working_immediately_after_deactivation(self):
        """La preuve la plus importante : un jeton émis AVANT la
        désactivation, encore valide (non expiré), doit cesser de
        fonctionner dès la requête SUIVANTE — pas seulement bloquer une
        future tentative de connexion.
        """
        admin_client, _admin_org, _admin_user = _register_admin(
            'backoffice-deactivate-jwt-admin@example.com', 'Org Backoffice Deactivate JWT Admin',
        )
        target_client, _organization, target_user, _decl, _msg = self._setup_target_with_history('jwt')

        # Le jeton du client cible a été émis AVANT toute désactivation —
        # confirmé fonctionnel une première fois.
        pre_response = target_client.get(reverse('me'))
        assert pre_response.status_code == 200

        deactivate_response = admin_client.post(reverse('backoffice-user-deactivate', args=[target_user.id]))
        assert deactivate_response.status_code == 200

        # Même client, même jeton JAMAIS renouvelé — la requête suivante
        # doit être rejetée, immédiatement.
        post_response = target_client.get(reverse('me'))
        assert post_response.status_code == 401

    def test_trust_event_message_and_document_remain_intact_after_deactivation(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'backoffice-deactivate-intact-admin@example.com', 'Org Backoffice Deactivate Intact Admin',
        )
        _target_client, organization, target_user, declaration, message = self._setup_target_with_history('intact')

        set_rls_context(user_id=target_user.id, organization_id=organization.id)
        event = trust_repository.get_current_status(declaration)
        assert event is not None
        event_id = event.id
        message_id = message.id

        admin_client.post(reverse('backoffice-user-deactivate', args=[target_user.id]))

        set_rls_context(organization_id=organization.id)
        # Le TrustEvent original existe toujours, avec son acteur/niveau
        # d'origine — jamais modifié ni supprimé par la désactivation.
        surviving_event = TrustEvent.objects.get(id=event_id)
        assert surviving_event.actor_id == target_user.id
        assert surviving_event.level == TrustLevel.DECLARE

        from apps.messaging.models import Message
        surviving_message = Message.objects.get(id=message_id)
        assert surviving_message.body == 'Message avant désactivation'
        assert surviving_message.author_id == target_user.id


@pytest.mark.django_db
class TestBackofficeNeverExposesATrustEventShortcut:
    """Ticket 011, critère d'acceptation explicite : « le back-office ne
    doit exposer aucune action qui court-circuiterait un TrustEvent (ex :
    pas de bouton "forcer un statut vérifié") ». Vérifié par un test de
    garde qui scanne le code source réel de ce module, pas seulement une
    revue manuelle — même pattern que les autres tests de garde de ce
    projet (attribution KEYIMMO, gouvernance StatusBadge).
    """

    def test_backoffice_urls_expose_exactly_the_documented_actions(self):
        """6 routes désormais (ticket B-041 a ajouté `backoffice-litige-list`
        et `backoffice-litige-resolve`, consciemment — voir
        apps/backoffice/urls.py) : ce test a fait exactement son travail en
        forçant cette mise à jour explicite plutôt que de laisser une route
        de plus se glisser sans qu'on la remarque. `LitigeResolveView`
        délègue toute la logique de résolution à
        `apps.support.services.resolve_litige`, qui n'écrit jamais de
        `TrustEvent` (voir Litige, docstring, et le test suivant).
        """
        from apps.backoffice.urls import urlpatterns
        names = {pattern.name for pattern in urlpatterns}
        assert names == {
            'backoffice-user-search', 'backoffice-user-detail', 'backoffice-user-deactivate',
            'backoffice-mission-create', 'backoffice-litige-list', 'backoffice-litige-resolve',
        }

    def test_backoffice_module_never_imports_or_references_the_trust_module(self):
        """Vérifie l'absence d'USAGE réel de `apps.trust` — pas une simple
        recherche de sous-chaîne « TrustEvent », qui apparaît aussi dans un
        commentaire explicatif légitime (`services.py::deactivate_user`
        précise justement que TrustEvent n'est PAS touché). Un import, ou un
        appel qui écrirait réellement un événement, sont ce qui compte ici.
        """
        from apps.backoffice import services, views

        source = inspect.getsource(views) + inspect.getsource(services)
        assert 'apps.trust' not in source
        assert 'trust_repository.create' not in source
        assert 'TrustEvent.objects.create' not in source

    def test_deactivate_view_accepts_no_body_fields_that_could_set_a_status(self):
        """`DeactivateUserView.post` n'a aucun serializer d'entrée — rien
        dans le corps de la requête n'est jamais lu ni interprété, donc
        rien ne peut y forger un `level`/`status`/`outcome` quelconque.
        """
        import apps.backoffice.views as views_module

        source = inspect.getsource(views_module.DeactivateUserView)
        assert 'request.data' not in source


def _open_litige_for_org(organization, lot, client_email):
    """Ouvre un litige directement via le service (pas l'endpoint HOME,
    déjà couvert par apps/home/tests.py) — le point testé ici est la
    visibilité/résolution ADMIN, pas l'ouverture elle-même.
    """
    from apps.support import services as support_services

    client_user = User.objects.create_user(email=client_email, password=PASSWORD)
    role, _ = Role.objects.get_or_create(code='client', defaults={'label': 'Client'})
    set_rls_context(user_id=client_user.id, organization_id=organization.id)
    Membership.objects.create(user=client_user, organization=organization, role=role)
    return support_services.open_litige(
        organization=organization, lot=lot, opened_by=client_user, description='Problème signalé par le client.',
    )


@pytest.mark.django_db
class TestLitigeAdminTransverseVisibility:
    """Ticket B-041 — critère central : `admin_keyimmo` voit et résout des
    litiges dans une organisation dont il n'est membre d'AUCUNE ligne
    `Membership` (nouvelle branche RLS transverse, voir
    apps/support/migrations/0002_rls.py).
    """

    def test_admin_sees_a_litige_in_an_organization_it_is_not_a_member_of(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'litige-visibility-admin@example.com', 'Org Litige Visibility Admin',
        )
        _constructeur_client, organization, _c_user, lot, _declaration = _setup_constructeur_org(
            'litige-visibility-constructeur@example.com', 'Org Litige Visibility Constructeur',
        )
        litige = _open_litige_for_org(organization, lot, 'litige-visibility-client@example.com')

        response = admin_client.get(reverse('backoffice-litige-list') + '?status=ouvert')

        assert response.status_code == 200
        litige_ids = {row['id'] for row in response.data}
        assert str(litige.id) in litige_ids

    def test_non_admin_cannot_list_litiges(self):
        constructeur_client, _organization, _c_user, _lot, _declaration = _setup_constructeur_org(
            'litige-perm-constructeur@example.com', 'Org Litige Perm Constructeur',
        )

        response = constructeur_client.get(reverse('backoffice-litige-list'))
        assert response.status_code == 403

    def test_admin_does_not_gain_blanket_visibility_of_a_lot_without_any_litige(self):
        """Régression réelle rencontrée en écrivant ce ticket : une première
        version de `apps/programs/migrations/0009_lot_admin_keyimmo_select.py`
        accordait à tort une visibilité GLOBALE de tout `Lot` à
        `admin_keyimmo`, cassant `apps.procurement.tests.TestAdminLotSearch::
        test_rls_context_is_restored_even_when_an_exception_interrupts_the_loop`
        (qui suppose, conformément à B-039, qu'un admin sans bascule RLS
        explicite ne voit pas les lots d'une autre organisation). La policy
        corrigée ne s'applique qu'aux lots ayant AU MOINS un `Litige` — un
        lot sans litige doit rester invisible, exactement comme avant ce
        ticket.
        """
        admin_client, _admin_org, _admin_user = _register_admin(
            'litige-no-blanket-admin@example.com', 'Org Litige No Blanket Admin',
        )
        _constructeur_client, _organization, _c_user, lot, _declaration = _setup_constructeur_org(
            'litige-no-blanket-constructeur@example.com', 'Org Litige No Blanket Constructeur',
        )
        # Aucun litige ouvert sur ce lot.

        from apps.core.rls import set_rls_context
        set_rls_context(user_id=_admin_user.id, organization_id=_admin_org.id)
        assert not Lot.objects.filter(id=lot.id).exists()

    def test_admin_resolves_a_litige_in_an_organization_it_is_not_a_member_of(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'litige-resolve-admin@example.com', 'Org Litige Resolve Admin',
        )
        _constructeur_client, organization, _c_user, lot, _declaration = _setup_constructeur_org(
            'litige-resolve-constructeur@example.com', 'Org Litige Resolve Constructeur',
        )
        litige = _open_litige_for_org(organization, lot, 'litige-resolve-client@example.com')

        response = admin_client.post(
            reverse('backoffice-litige-resolve', args=[litige.id]),
            {'status': 'resolu', 'resolution_note': 'Appelé le client, malentendu clarifié.'},
            format='json',
        )

        assert response.status_code == 200, response.data
        assert response.data['status'] == 'resolu'
        assert response.data['resolution_note'] == 'Appelé le client, malentendu clarifié.'
        assert response.data['resolved_by_email'] == 'litige-resolve-admin@example.com'

    def test_non_admin_cannot_resolve_a_litige(self):
        constructeur_client, organization, _c_user, lot, _declaration = _setup_constructeur_org(
            'litige-resolve-perm-constructeur@example.com', 'Org Litige Resolve Perm Constructeur',
        )
        litige = _open_litige_for_org(organization, lot, 'litige-resolve-perm-client@example.com')

        response = constructeur_client.post(
            reverse('backoffice-litige-resolve', args=[litige.id]),
            {'status': 'resolu', 'resolution_note': 'Tentative illégitime.'},
            format='json',
        )
        assert response.status_code == 403

    def test_resolving_without_a_note_is_rejected(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'litige-note-admin@example.com', 'Org Litige Note Admin',
        )
        _constructeur_client, organization, _c_user, lot, _declaration = _setup_constructeur_org(
            'litige-note-constructeur@example.com', 'Org Litige Note Constructeur',
        )
        litige = _open_litige_for_org(organization, lot, 'litige-note-client@example.com')

        response = admin_client.post(
            reverse('backoffice-litige-resolve', args=[litige.id]),
            {'status': 'resolu', 'resolution_note': '   '},
            format='json',
        )
        assert response.status_code == 400

    def test_resolving_an_already_closed_litige_is_rejected(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'litige-twice-admin@example.com', 'Org Litige Twice Admin',
        )
        _constructeur_client, organization, _c_user, lot, _declaration = _setup_constructeur_org(
            'litige-twice-constructeur@example.com', 'Org Litige Twice Constructeur',
        )
        litige = _open_litige_for_org(organization, lot, 'litige-twice-client@example.com')
        admin_client.post(
            reverse('backoffice-litige-resolve', args=[litige.id]),
            {'status': 'resolu', 'resolution_note': 'Première résolution.'},
            format='json',
        )

        response = admin_client.post(
            reverse('backoffice-litige-resolve', args=[litige.id]),
            {'status': 'rejete', 'resolution_note': 'Deuxième tentative.'},
            format='json',
        )
        assert response.status_code == 400

    def test_resolving_a_litige_never_writes_a_trust_event(self):
        """Critère d'acceptation explicite (B-041) : un litige n'est pas un
        objet Visible Trust — le résoudre ne doit produire AUCUN
        `TrustEvent`, contrairement à une réserve (ticket 005).
        """
        admin_client, _admin_org, _admin_user = _register_admin(
            'litige-no-trust-admin@example.com', 'Org Litige No Trust Admin',
        )
        _constructeur_client, organization, _c_user, lot, _declaration = _setup_constructeur_org(
            'litige-no-trust-constructeur@example.com', 'Org Litige No Trust Constructeur',
        )
        litige = _open_litige_for_org(organization, lot, 'litige-no-trust-client@example.com')
        set_rls_context(organization_id=organization.id)
        count_before = TrustEvent.objects.filter(organization=organization).count()

        admin_client.post(
            reverse('backoffice-litige-resolve', args=[litige.id]),
            {'status': 'resolu', 'resolution_note': 'Résolu, aucun impact Visible Trust.'},
            format='json',
        )

        set_rls_context(organization_id=organization.id)
        assert TrustEvent.objects.filter(organization=organization).count() == count_before
