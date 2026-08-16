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

    def test_backoffice_urls_expose_exactly_the_three_documented_actions(self):
        from apps.backoffice.urls import urlpatterns
        names = {pattern.name for pattern in urlpatterns}
        assert names == {'backoffice-user-search', 'backoffice-user-detail', 'backoffice-user-deactivate'}

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
