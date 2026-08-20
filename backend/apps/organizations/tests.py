import uuid

import psycopg2
import pytest
from django.db import connection
from django.db.utils import ProgrammingError as DjangoProgrammingError
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context

from .models import CountryPack, Membership, Organization, Role

PASSWORD = 'strongpass123'


def _register(email, organization_name, role_code='sponsor'):
    """Même helper que les autres modules de test de ce projet — dupliqué
    volontairement (discipline déjà assumée, voir apps/pricing/tests.py).
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


def _register_admin(email, organization_name):
    return _register(email, organization_name, role_code='admin_keyimmo')


def _register_constructeur(email, organization_name):
    return _register(email, organization_name, role_code='constructeur')


def _raw_sql(sql, params):
    """Exécute du SQL brut sur la connexion Django elle-même (même session,
    même transaction que l'ORM) — hors ORM, donc hors tout filtrage
    applicatif, mais toujours dans la même transaction que la fixture pour
    que les lignes créées y soient visibles (une connexion psycopg2 séparée
    ne verrait pas les lignes non committées de la transaction de test).
    C'est la policy RLS elle-même qui est exercée ici, pas l'ORM Django ni
    une vue DRF.
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        try:
            return cursor.fetchall()
        except psycopg2.ProgrammingError:
            return None


def _set_context(*, user_id=None, organization_id=None):
    if user_id is not None:
        _raw_sql("SELECT set_config('app.current_user_id', %s, true)", [str(user_id)])
    if organization_id is not None:
        _raw_sql("SELECT set_config('app.current_organization_id', %s, true)", [str(organization_id)])


@pytest.fixture
def two_orgs(db):
    senegal = CountryPack.objects.get(code='SN')
    role, _ = Role.objects.get_or_create(code='sponsor', defaults={'label': 'Sponsor'})

    org_a = Organization.objects.create(name='Org A', country_pack=senegal)
    org_b = Organization.objects.create(name='Org B', country_pack=senegal)

    user_a = User.objects.create_user(email='a@example.com', password='pass12345')
    user_b = User.objects.create_user(email='b@example.com', password='pass12345')

    # Comme dans le flux d'inscription réel (RegisterSerializer.create) : la
    # policy RLS INSERT exige que organization_id corresponde à
    # l'organisation active du contexte — il faut donc le poser explicitement
    # avant chaque création, ce test ne passant pas par le middleware.
    set_rls_context(user_id=user_a.id, organization_id=org_a.id)
    membership_a = Membership.objects.create(user=user_a, organization=org_a, role=role)

    set_rls_context(user_id=user_b.id, organization_id=org_b.id)
    membership_b = Membership.objects.create(user=user_b, organization=org_b, role=role)

    return {
        'org_a': org_a,
        'org_b': org_b,
        'user_a': user_a,
        'user_b': user_b,
        'membership_a': membership_a,
        'membership_b': membership_b,
        'role': role,
    }


class TestMembershipRowLevelSecurity:
    """Ticket 001 — critère d'acceptation : un utilisateur ne peut jamais
    lire ou écrire une donnée d'une organisation dont il n'est pas membre,
    même en forgeant `organization_id` — vérifié au niveau DB (policy RLS
    exercée en SQL brut), pas seulement applicatif.
    """

    def test_select_hides_foreign_org_membership_despite_forged_organization_id(self, two_orgs):
        # user_a force le contexte sur org_b (dont il n'est pas membre) pour
        # tenter de lire la ligne de membership de user_b.
        _set_context(user_id=two_orgs['user_a'].id, organization_id=two_orgs['org_b'].id)
        rows = _raw_sql(
            'SELECT id FROM organizations_membership WHERE id = %s',
            [str(two_orgs['membership_b'].id)],
        )

        assert rows == [], (
            'La policy RLS a laissé passer une lecture inter-organisation malgré '
            'organization_id forgé.'
        )

    def test_insert_is_rejected_when_organization_id_does_not_match_active_org(self, two_orgs):
        # Contexte légitime : user_a dans son organisation A. Il tente malgré
        # tout d'insérer une ligne rattachée à l'organisation B en forgeant
        # organization_id directement dans l'INSERT.
        _set_context(user_id=two_orgs['user_a'].id, organization_id=two_orgs['org_a'].id)
        # Django enveloppe les exceptions psycopg2 dans sa propre hiérarchie
        # (InsufficientPrivilege, SQLSTATE 42501, devient ProgrammingError) —
        # on passe par la connexion Django (voir _raw_sql), donc c'est cette
        # exception-là qui remonte, pas la classe psycopg2 d'origine.
        with pytest.raises(DjangoProgrammingError):
            _raw_sql(
                """
                INSERT INTO organizations_membership
                    (id, user_id, organization_id, role_id, created_at)
                VALUES (%s, %s, %s, %s, now())
                """,
                [
                    str(uuid.uuid4()),
                    str(two_orgs['user_a'].id),
                    str(two_orgs['org_b'].id),
                    str(two_orgs['role'].id),
                ],
            )

    def test_legitimate_read_within_own_active_organization_succeeds(self, two_orgs):
        _set_context(user_id=two_orgs['user_a'].id, organization_id=two_orgs['org_a'].id)
        rows = _raw_sql(
            'SELECT id FROM organizations_membership WHERE id = %s',
            [str(two_orgs['membership_a'].id)],
        )

        assert len(rows) == 1

    def test_own_membership_is_readable_regardless_of_active_organization(self, two_orgs):
        # Nécessaire pour GET /me : user_a doit pouvoir lire sa propre ligne
        # de membership même quand le contexte d'organisation active pointe
        # ailleurs (ex : forgée sur org_b, comme dans le test précédent).
        _set_context(user_id=two_orgs['user_a'].id, organization_id=two_orgs['org_b'].id)
        rows = _raw_sql(
            'SELECT id FROM organizations_membership WHERE id = %s',
            [str(two_orgs['membership_a'].id)],
        )

        assert len(rows) == 1


@pytest.mark.django_db
def test_country_pack_senegal_exists_as_seeded_data():
    senegal = CountryPack.objects.get(code='SN')
    assert senegal.label == 'Sénégal'
    assert senegal.is_active is True


@pytest.mark.django_db
class TestCountryPackList:
    """`GET /api/organizations/country-packs/` — ticket B-030."""

    def test_admin_keyimmo_can_list_active_country_packs(self):
        admin_client, _org, _user = _register_admin(
            'country-pack-list-admin@example.com', 'Org Country Pack List Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        response = admin_client.get(reverse('country-pack-list'))
        assert response.status_code == 200
        row = next(r for r in response.data if r['code'] == 'SN')
        assert row['id'] == str(senegal.id)
        assert row['label'] == senegal.label

    def test_an_inactive_country_pack_is_absent_from_the_response(self):
        """Cœur du ticket (décision A) : premier usage réel de
        `CountryPack.is_active` dans ce projet — prouvé avec un
        `CountryPack` inactif créé pour l'occasion, absent de la réponse.
        """
        admin_client, _org, _user = _register_admin(
            'country-pack-list-inactive-admin@example.com', 'Org Country Pack List Inactive Admin',
        )
        inactive_pack = CountryPack.objects.create(code='ZZ', label='Pays Inactif Test', is_active=False)

        response = admin_client.get(reverse('country-pack-list'))
        assert response.status_code == 200
        codes = {row['code'] for row in response.data}
        assert inactive_pack.code not in codes

    def test_a_constructeur_cannot_list_country_packs(self):
        constructeur_client, _org, _user = _register_constructeur(
            'country-pack-list-forbidden@example.com', 'Org Country Pack List Forbidden',
        )
        response = constructeur_client.get(reverse('country-pack-list'))
        assert response.status_code == 403

    def test_response_is_sorted_by_label(self):
        admin_client, _org, _user = _register_admin(
            'country-pack-list-sorted-admin@example.com', 'Org Country Pack List Sorted Admin',
        )
        CountryPack.objects.create(code='ZY', label='Zambie Test', is_active=True)
        CountryPack.objects.create(code='AL', label='Algérie Test', is_active=True)

        response = admin_client.get(reverse('country-pack-list'))
        assert response.status_code == 200
        labels = [row['label'] for row in response.data]
        assert labels == sorted(labels)

    def test_each_element_has_exactly_id_label_code(self):
        admin_client, _org, _user = _register_admin(
            'country-pack-list-shape-admin@example.com', 'Org Country Pack List Shape Admin',
        )
        response = admin_client.get(reverse('country-pack-list'))
        assert response.status_code == 200
        assert len(response.data) >= 1
        for row in response.data:
            assert set(row.keys()) == {'id', 'label', 'code'}
