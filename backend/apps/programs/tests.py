from pathlib import Path

import pytest
from django.db import connection
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Organization

from .models import Asset, Lot, LotClient, MilestoneTemplate, MilestoneTemplateStep, Program

PASSWORD = 'strongpass123'


def _register_and_authenticate(email, organization_name):
    client = APIClient()
    client.post(
        reverse('register'),
        {'email': email, 'password': PASSWORD, 'organization_name': organization_name},
        format='json',
    )
    token = client.post(
        reverse('login'), {'email': email, 'password': PASSWORD}, format='json',
    ).data['access']
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
    return client


def _create_program(client, name='Programme Test'):
    return client.post(reverse('program-list'), {'name': name}, format='json').data


def _create_asset(client, program_id, name='Bien Test'):
    return client.post(reverse('asset-list'), {'name': name, 'program': program_id}, format='json').data


def _create_lot(client, asset_id, name='Lot Test'):
    return client.post(reverse('lot-list'), {'name': name, 'asset': asset_id}, format='json').data


@pytest.mark.django_db
class TestMilestoneInstantiation:
    """Ticket 002 — critère d'acceptation : modifier un MilestoneTemplate en
    base change les jalons des nouveaux lots, sans toucher au code
    applicatif, tandis que les jalons déjà créés restent inchangés
    (instantané pris à la création du lot, pas une référence vivante).
    """

    def test_new_lot_gets_milestones_matching_active_template_content(self):
        # Les codes attendus viennent de la base (le template actif), jamais
        # d'une liste écrite en dur ici — sinon ce test lui-même violerait le
        # critère d'acceptation qu'il est censé vérifier.
        senegal = CountryPack.objects.get(code='SN')
        active_template = MilestoneTemplate.objects.get(country_pack=senegal, is_active=True)
        expected_steps = list(
            active_template.steps.order_by('order').values('order', 'code', 'label'),
        )

        client = _register_and_authenticate('sponsor1@example.com', 'Org Jalons 1')
        program = _create_program(client)
        asset = _create_asset(client, program['id'])
        lot = _create_lot(client, asset['id'])

        hierarchy = client.get(reverse('program-hierarchy', args=[program['id']])).data
        milestones = hierarchy['assets'][0]['lots'][0]['milestones']
        actual_steps = [
            {'order': m['order'], 'code': m['code'], 'label': m['label']} for m in milestones
        ]

        assert actual_steps == expected_steps

    def test_editing_template_in_db_only_affects_lots_created_afterwards(self):
        client = _register_and_authenticate('sponsor2@example.com', 'Org Jalons 2')
        program = _create_program(client)
        asset = _create_asset(client, program['id'])

        lot_before = _create_lot(client, asset['id'], name='Lot avant modification')

        # Modification directe en base — aucun code applicatif touché, tout
        # comme le décrit le critère d'acceptation.
        senegal = CountryPack.objects.get(code='SN')
        template = MilestoneTemplate.objects.get(country_pack=senegal, is_active=True)
        MilestoneTemplateStep.objects.create(
            template=template, order=99, code='essai_jalon_supplementaire', label='Jalon ajouté en base',
        )

        lot_after = _create_lot(client, asset['id'], name='Lot après modification')

        before_codes = [
            m.code for m in Lot.objects.get(id=lot_before['id']).milestones.all()
        ]
        after_codes = [
            m.code for m in Lot.objects.get(id=lot_after['id']).milestones.all()
        ]

        assert 'essai_jalon_supplementaire' not in before_codes
        assert 'essai_jalon_supplementaire' in after_codes


@pytest.mark.django_db
class TestNoHardcodedMilestoneNames:
    """Ticket 002 — critère d'acceptation : « Aucun test ni endpoint ne
    référence un nom de jalon en dur dans le code métier » — donc `tests.py`
    lui-même est dans le périmètre du scan, pas seulement models/services/
    serializers/views. Seules les migrations ont le droit d'écrire ces noms
    (c'est littéralement leur rôle : y insérer la donnée).
    """

    SCANNED_FILES = [
        'admin.py', 'apps.py', 'models.py', 'serializers.py',
        'services.py', 'tests.py', 'urls.py', 'views.py',
    ]

    def test_no_scanned_file_references_a_seeded_milestone_code(self):
        # Les codes à chercher viennent de la base — jamais d'une liste
        # écrite en dur ici, sinon ce fichier violerait lui-même le critère
        # qu'il vérifie.
        codes = list(MilestoneTemplateStep.objects.values_list('code', flat=True))
        assert codes, 'Aucun MilestoneTemplateStep en base — le seed a-t-il tourné ?'

        app_dir = Path(__file__).parent
        offending = []
        for filename in self.SCANNED_FILES:
            path = app_dir / filename
            if not path.exists():
                continue
            content = path.read_text(encoding='utf-8')
            for code in codes:
                if code in content:
                    offending.append((filename, code))

        assert offending == [], (
            f'Des noms de jalons sont codés en dur hors des migrations : {offending}'
        )


@pytest.mark.django_db
class TestHierarchyIntegrity:
    """Ticket 002 — critère d'acceptation : un lot appartient toujours à un
    seul bien, un bien à un seul programme.
    """

    def test_asset_creation_requires_a_program(self):
        client = _register_and_authenticate('integrity1@example.com', 'Org Intégrité 1')
        response = client.post(reverse('asset-list'), {'name': 'Bien orphelin'}, format='json')
        assert response.status_code == 400
        assert 'program' in response.data

    def test_lot_creation_requires_an_asset(self):
        client = _register_and_authenticate('integrity2@example.com', 'Org Intégrité 2')
        response = client.post(reverse('lot-list'), {'name': 'Lot orphelin'}, format='json')
        assert response.status_code == 400
        assert 'asset' in response.data

    def test_asset_foreign_key_to_program_is_not_nullable_at_db_level(self):
        field = Asset._meta.get_field('program')
        assert field.null is False
        assert field.many_to_many is False

    def test_lot_foreign_key_to_asset_is_not_nullable_at_db_level(self):
        field = Lot._meta.get_field('asset')
        assert field.null is False
        assert field.many_to_many is False


@pytest.mark.django_db
class TestCrudIsOrganizationScoped:
    """Ticket 002 — scope explicite : « CRUD Program, Asset, Lot scopés par
    organisation (RLS du ticket 001) ». Un test par table : chacune a sa
    propre policy RLS (voir migration 0002_programs_rls.py), donc chacune
    doit être prouvée séparément — un bug dans la policy d'une seule table
    ne serait pas détecté en ne testant que Program (voir l'incident de
    policy découvert sur Membership au ticket 001, qui n'aurait pas été vu
    par un test générique).
    """

    def _setup_org_a_hierarchy_then_switch_to_org_b(self):
        client_a = _register_and_authenticate('crud-a@example.com', 'Org CRUD A')
        program_a = _create_program(client_a, name='Programme A')
        asset_a = _create_asset(client_a, program_a['id'], name='Bien A')
        lot_a = _create_lot(client_a, asset_a['id'], name='Lot A')

        client_b = _register_and_authenticate('crud-b@example.com', 'Org CRUD B')
        return client_b, program_a, asset_a, lot_a

    @staticmethod
    def _assert_not_visible(client, detail_url_name, list_url_name, object_id):
        response = client.get(reverse(detail_url_name, args=[object_id]))
        assert response.status_code == 404

        list_response = client.get(reverse(list_url_name))
        ids = [row['id'] for row in list_response.data]
        assert object_id not in ids

    def test_program_of_another_organization_is_not_visible(self):
        client_b, program_a, _asset_a, _lot_a = self._setup_org_a_hierarchy_then_switch_to_org_b()
        self._assert_not_visible(client_b, 'program-detail', 'program-list', program_a['id'])

    def test_asset_of_another_organization_is_not_visible(self):
        client_b, _program_a, asset_a, _lot_a = self._setup_org_a_hierarchy_then_switch_to_org_b()
        self._assert_not_visible(client_b, 'asset-detail', 'asset-list', asset_a['id'])

    def test_lot_of_another_organization_is_not_visible(self):
        client_b, _program_a, _asset_a, lot_a = self._setup_org_a_hierarchy_then_switch_to_org_b()
        self._assert_not_visible(client_b, 'lot-detail', 'lot-list', lot_a['id'])


def _raw_sql(sql, params):
    """Même utilitaire que `apps/organizations/tests.py::_raw_sql` (dupliqué
    volontairement, pas importé — chaque fichier de test RLS de ce projet
    reste autonome, voir CLAUDE.md) : SQL brut sur la connexion Django elle-
    même, hors ORM, pour exercer la policy RLS directement.
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        try:
            return cursor.fetchall()
        except Exception:
            return None


@pytest.mark.django_db
class TestLotClientRowLevelSecurity:
    """Ticket 008 — `programs_lot_client` porte l'assignation client → lot
    qui fonde le critère de sécurité central du ticket (« le client ne voit
    aucune donnée d'un autre lot que le ou les siens »). Comme toute nouvelle
    table de ce projet (CLAUDE.md, section RLS multi-tenant), sa policy est
    prouvée en SQL brut, pas seulement via l'API — voir
    apps/organizations/tests.py pour le test de référence.
    """

    def test_select_hides_lot_client_of_another_organization_despite_forged_context(self):
        senegal = CountryPack.objects.get(code='SN')
        org_a = Organization.objects.create(name='Org LotClient A', country_pack=senegal)
        org_b = Organization.objects.create(name='Org LotClient B', country_pack=senegal)

        client_user = User.objects.create_user(email='lotclient-rls@example.com', password='pass12345')
        outsider = User.objects.create_user(email='lotclient-outsider@example.com', password='pass12345')

        set_rls_context(user_id=client_user.id, organization_id=org_a.id)
        program = Program.objects.create(organization=org_a, name='Programme A')
        asset = Asset.objects.create(organization=org_a, program=program, name='Bien A')
        lot = Lot.objects.create(organization=org_a, asset=asset, name='Lot A')
        assignment = LotClient.objects.create(organization=org_a, lot=lot, client=client_user)

        # Contexte forgé vers l'organisation B, dont ni le client ni
        # l'outsider ne sont membres — même schéma que le test de référence
        # du ticket 001 (apps/organizations/tests.py).
        set_rls_context(user_id=outsider.id, organization_id=org_b.id)
        rows = _raw_sql(
            'SELECT id FROM programs_lot_client WHERE id = %s', [str(assignment.id)],
        )

        assert rows == [], (
            'La policy RLS a laissé passer une lecture inter-organisation de '
            'programs_lot_client malgré un contexte forgé.'
        )
