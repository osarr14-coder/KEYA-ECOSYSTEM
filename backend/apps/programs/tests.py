from decimal import Decimal
from pathlib import Path
from unittest import mock

import pytest
from django.db import connection, transaction
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Membership, Organization, Role

from . import services
from .models import (
    Asset,
    Lot,
    LotClient,
    MilestoneTemplate,
    MilestoneTemplateStep,
    Program,
    ProgramCost,
    ProgramCostRepartitionMethod,
    ProgramRequest,
)

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


def _register_admin(email, organization_name):
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
    role, _ = Role.objects.get_or_create(code='admin_keyimmo', defaults={'label': 'Admin Keyimmo'})
    Membership.objects.filter(user=user, organization=organization).update(role=role)

    return client, organization, user


_admin_client_sequence = 0


def _any_admin_client():
    """Client `admin_keyimmo` jetable, pour les fixtures qui n'ont besoin
    que d'un exécutant autorisé — ticket B-039, création de
    Program/Asset/Lot réservée à `admin_keyimmo`, jamais self-service.
    Compteur (pas `uuid`) pour un email/nom d'organisation lisible et
    unique par appel, même discipline que les suffixes déjà utilisés
    ailleurs dans ce fichier (`_setup_sponsor_program_with_lots`).
    """
    global _admin_client_sequence
    _admin_client_sequence += 1
    suffix = _admin_client_sequence
    client, _organization, _user = _register_admin(
        f'fixture-admin-{suffix}@example.com', f'Org Fixture Admin {suffix}',
    )
    return client


def _create_program(admin_client, organization_id, name='Programme Test'):
    """Ticket B-039 — création réservée à `admin_keyimmo`, `organization`
    fourni explicitement (l'admin n'est pas forcément membre de la cible).
    """
    return admin_client.post(
        reverse('program-list'), {'organization': str(organization_id), 'name': name}, format='json',
    ).data


def _create_asset(admin_client, organization_id, program_id, name='Bien Test'):
    return admin_client.post(
        reverse('asset-list'),
        {'organization': str(organization_id), 'program': str(program_id), 'name': name},
        format='json',
    ).data


def _create_lot(admin_client, organization_id, asset_id, name='Lot Test', surface=None):
    payload = {'organization': str(organization_id), 'asset': str(asset_id), 'name': name}
    if surface is not None:
        payload['surface'] = str(surface)
    return admin_client.post(reverse('lot-list'), payload, format='json').data


def _setup_sponsor_program_with_lots(suffix, lot_surfaces=(None,)):
    """Programme réel d'une organisation SPONSOR, avec un ou plusieurs lots
    — `lot_surfaces` : un `Decimal`/`None` par lot à créer. Retourne
    `(sponsor_organization, program_dict, [lot_dict, ...])`.

    `_sponsor_client` (inutilisé au-delà de la création de l'organisation
    elle-même) reste nécessaire : c'est l'inscription qui crée
    `Organization`, la CRÉATION du programme/bien/lots passe désormais par
    un `admin_keyimmo` distinct (ticket B-039), jamais par ce client.
    """
    _sponsor_client = _register_and_authenticate(
        f'sponsor-cost-{suffix}@example.com', f'Org Sponsor Cost {suffix}',
    )
    sponsor_org = Organization.objects.get(name=f'Org Sponsor Cost {suffix}')
    admin_client = _any_admin_client()
    program = _create_program(admin_client, sponsor_org.id, f'Programme Cost {suffix}')
    asset = _create_asset(admin_client, sponsor_org.id, program['id'], f'Bien Cost {suffix}')
    lots = [
        _create_lot(admin_client, sponsor_org.id, asset['id'], f'Lot {index} {suffix}', surface=surface)
        for index, surface in enumerate(lot_surfaces)
    ]
    return sponsor_org, program, lots


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
        organization = Organization.objects.get(name='Org Jalons 1')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization.id)
        asset = _create_asset(admin_client, organization.id, program['id'])
        lot = _create_lot(admin_client, organization.id, asset['id'])

        hierarchy = client.get(reverse('program-hierarchy', args=[program['id']])).data
        milestones = hierarchy['assets'][0]['lots'][0]['milestones']
        actual_steps = [
            {'order': m['order'], 'code': m['code'], 'label': m['label']} for m in milestones
        ]

        assert actual_steps == expected_steps

    def test_editing_template_in_db_only_affects_lots_created_afterwards(self):
        _client = _register_and_authenticate('sponsor2@example.com', 'Org Jalons 2')
        organization = Organization.objects.get(name='Org Jalons 2')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization.id)
        asset = _create_asset(admin_client, organization.id, program['id'])

        lot_before = _create_lot(admin_client, organization.id, asset['id'], name='Lot avant modification')

        # Modification directe en base — aucun code applicatif touché, tout
        # comme le décrit le critère d'acceptation.
        senegal = CountryPack.objects.get(code='SN')
        template = MilestoneTemplate.objects.get(country_pack=senegal, is_active=True)
        MilestoneTemplateStep.objects.create(
            template=template, order=99, code='essai_jalon_supplementaire', label='Jalon ajouté en base',
        )

        lot_after = _create_lot(admin_client, organization.id, asset['id'], name='Lot après modification')

        # Bascule RLS explicite vers l'organisation cible : chaque appel
        # `services.create_lot` ci-dessus restaure le contexte RLS de
        # l'admin dans son `finally` (ticket B-039) — une relecture ORM
        # directe non basculée échouerait silencieusement (piège déjà
        # documenté, voir TestProgramCostImmutability plus haut).
        set_rls_context(organization_id=organization.id)
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

        # Correspondance sur le LITTÉRAL de chaîne (code entouré de
        # guillemets simples ou doubles), pas une sous-chaîne brute —
        # corrigé au ticket B-033 : deux codes seedés (l'un désignant
        # l'acquisition du terrain, l'autre la phase d'étude) sont aussi
        # des mots français ordinaires/des fragments de noms de champs
        # légitimes ailleurs dans ce module (`ProgramCost.foncier_total`,
        # le mot « conception » employé normalement dans des docstrings) —
        # une sous-chaîne brute y déclenchait un faux positif sans rapport
        # avec l'intention réelle de ce test (empêcher un CODE de jalon
        # codé en dur comme littéral de chaîne quelque part dans le
        # fichier). Toujours détecté avec cette précision — seule la
        # fausse alerte disparaît.
        app_dir = Path(__file__).parent
        offending = []
        for filename in self.SCANNED_FILES:
            path = app_dir / filename
            if not path.exists():
                continue
            content = path.read_text(encoding='utf-8')
            for code in codes:
                if f"'{code}'" in content or f'"{code}"' in content:
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
        # Ticket B-039 : la création est réservée à admin_keyimmo — un
        # 403 masquerait le 400 réellement testé ici (le champ manquant),
        # donc l'appelant doit être un admin, `organization` fourni.
        admin_client, organization, _user = _register_admin('integrity1-admin@example.com', 'Org Intégrité 1 Admin')
        response = admin_client.post(
            reverse('asset-list'), {'organization': str(organization.id), 'name': 'Bien orphelin'}, format='json',
        )
        assert response.status_code == 400
        assert 'program' in response.data

    def test_lot_creation_requires_an_asset(self):
        admin_client, organization, _user = _register_admin('integrity2-admin@example.com', 'Org Intégrité 2 Admin')
        response = admin_client.post(
            reverse('lot-list'), {'organization': str(organization.id), 'name': 'Lot orphelin'}, format='json',
        )
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
        _client_a = _register_and_authenticate('crud-a@example.com', 'Org CRUD A')
        organization_a = Organization.objects.get(name='Org CRUD A')
        admin_client = _any_admin_client()
        program_a = _create_program(admin_client, organization_a.id, name='Programme A')
        asset_a = _create_asset(admin_client, organization_a.id, program_a['id'], name='Bien A')
        lot_a = _create_lot(admin_client, organization_a.id, asset_a['id'], name='Lot A')

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


@pytest.mark.django_db
class TestLotAssignedOrganization:
    """Ticket 009 (BUILD Control Tower) — `Lot.assigned_organization` est un
    point d'ancrage minimal pour un futur module PRO (voir docstring du
    modèle) : ce test couvre uniquement le mécanisme (le champ se pose, un
    lot sans affectation reste `null`), pas un quelconque flux de
    candidature.
    """

    def test_lot_has_no_assigned_organization_by_default(self):
        _client = _register_and_authenticate('assign-default@example.com', 'Org Assign Default')
        organization = Organization.objects.get(name='Org Assign Default')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization.id)
        asset = _create_asset(admin_client, organization.id, program['id'])
        lot = _create_lot(admin_client, organization.id, asset['id'])

        assert lot['assigned_organization'] is None

    def test_assign_organization_sets_the_field(self):
        client = _register_and_authenticate('assign-sets@example.com', 'Org Assign Sets')
        organization = Organization.objects.get(name='Org Assign Sets')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization.id)
        asset = _create_asset(admin_client, organization.id, program['id'])
        lot = _create_lot(admin_client, organization.id, asset['id'])

        senegal = CountryPack.objects.get(code='SN')
        constructeur_org = Organization.objects.create(name='Org Constructeur Cible', country_pack=senegal)

        response = client.post(
            reverse('lot-assign-organization', args=[lot['id']]),
            {'organization_id': str(constructeur_org.id)}, format='json',
        )

        assert response.status_code == 200
        assert response.data['assigned_organization'] == constructeur_org.id

        # Persisté, pas seulement renvoyé dans la réponse.
        refreshed = client.get(reverse('lot-detail', args=[lot['id']])).data
        assert refreshed['assigned_organization'] == constructeur_org.id

    def test_assign_organization_requires_organization_id(self):
        client = _register_and_authenticate('assign-requires@example.com', 'Org Assign Requires')
        organization = Organization.objects.get(name='Org Assign Requires')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization.id)
        asset = _create_asset(admin_client, organization.id, program['id'])
        lot = _create_lot(admin_client, organization.id, asset['id'])

        response = client.post(reverse('lot-assign-organization', args=[lot['id']]), {}, format='json')

        assert response.status_code == 400

    def test_assign_organization_rejects_an_unknown_organization_id(self):
        client = _register_and_authenticate('assign-unknown@example.com', 'Org Assign Unknown')
        organization = Organization.objects.get(name='Org Assign Unknown')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization.id)
        asset = _create_asset(admin_client, organization.id, program['id'])
        lot = _create_lot(admin_client, organization.id, asset['id'])

        response = client.post(
            reverse('lot-assign-organization', args=[lot['id']]),
            {'organization_id': '00000000-0000-0000-0000-000000000000'}, format='json',
        )

        assert response.status_code == 400

    def test_assign_organization_on_a_lot_of_another_organization_returns_404(self):
        _client_a = _register_and_authenticate('assign-other-a@example.com', 'Org Assign Other A')
        organization_a = Organization.objects.get(name='Org Assign Other A')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization_a.id)
        asset = _create_asset(admin_client, organization_a.id, program['id'])
        lot = _create_lot(admin_client, organization_a.id, asset['id'])

        client_b = _register_and_authenticate('assign-other-b@example.com', 'Org Assign Other B')
        senegal = CountryPack.objects.get(code='SN')
        target_org = Organization.objects.create(name='Org Assign Other Target', country_pack=senegal)

        response = client_b.post(
            reverse('lot-assign-organization', args=[lot['id']]),
            {'organization_id': str(target_org.id)}, format='json',
        )

        assert response.status_code == 404


@pytest.mark.django_db
class TestLotSurfaceField:
    """Ticket B-033 — prérequis réel : `Lot.surface` n'existait pas avant
    ce ticket, vérifié avant conception.
    """

    def test_surface_can_be_set_via_the_existing_lot_endpoint(self):
        _client = _register_and_authenticate('lot-surface-set@example.com', 'Org Lot Surface Set')
        organization = Organization.objects.get(name='Org Lot Surface Set')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization.id)
        asset = _create_asset(admin_client, organization.id, program['id'])

        lot = _create_lot(admin_client, organization.id, asset['id'], surface=Decimal('120.50'))
        assert Decimal(lot['surface']) == Decimal('120.50')

    def test_surface_is_null_by_default_no_guessed_value(self):
        _client = _register_and_authenticate('lot-surface-default@example.com', 'Org Lot Surface Default')
        organization = Organization.objects.get(name='Org Lot Surface Default')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization.id)
        asset = _create_asset(admin_client, organization.id, program['id'])

        lot = _create_lot(admin_client, organization.id, asset['id'])
        assert lot['surface'] is None


@pytest.mark.django_db
class TestProgramCostCreation:
    def test_admin_keyimmo_can_create_a_program_cost_for_a_program_he_is_not_a_member_of(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('create')
        admin_client, _admin_org, admin_user = _register_admin(
            'program-cost-create-admin@example.com', 'Org Program Cost Create Admin',
        )
        assert sponsor_org.id != _admin_org.id  # organisations distinctes par construction — la bascule RLS est réellement exercée

        response = admin_client.post(
            reverse('program-cost-create', args=[program['id']]),
            {
                'organization': str(sponsor_org.id),
                'foncier_total': '150000000.00',
                'be_total': '10000000.00',
                'repartition_method': ProgramCostRepartitionMethod.PARTS_EGALES,
                'justification': 'Estimation initiale du foncier et du BE, validée par le sponsor.',
            },
            format='json',
        )
        assert response.status_code == 201, response.data
        assert Decimal(response.data['foncier_total']) == Decimal('150000000.00')
        assert Decimal(response.data['be_total']) == Decimal('10000000.00')
        assert response.data['repartition_method'] == ProgramCostRepartitionMethod.PARTS_EGALES
        assert response.data['created_by'] == admin_user.id

    def test_a_sponsor_cannot_create_a_program_cost(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('forbidden')
        _sponsor_client = _register_and_authenticate(
            'program-cost-forbidden@example.com', 'Org Program Cost Forbidden',
        )

        response = _sponsor_client.post(
            reverse('program-cost-create', args=[program['id']]),
            {
                'organization': str(sponsor_org.id),
                'foncier_total': '1.00',
                'be_total': '1.00',
                'repartition_method': ProgramCostRepartitionMethod.PARTS_EGALES,
                'justification': 'Tentative refusée.',
            },
            format='json',
        )
        assert response.status_code == 403

    def test_an_empty_justification_is_rejected(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('empty-justif')
        admin_client, _admin_org, _admin_user = _register_admin(
            'program-cost-empty-justif-admin@example.com', 'Org Program Cost Empty Justif Admin',
        )

        response = admin_client.post(
            reverse('program-cost-create', args=[program['id']]),
            {
                'organization': str(sponsor_org.id),
                'foncier_total': '1.00',
                'be_total': '1.00',
                'repartition_method': ProgramCostRepartitionMethod.PARTS_EGALES,
                'justification': '   ',
            },
            format='json',
        )
        assert response.status_code == 400
        assert not ProgramCost.objects.filter(program_id=program['id']).exists()

    def test_an_invalid_repartition_method_is_rejected(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('bad-method')
        admin_client, _admin_org, _admin_user = _register_admin(
            'program-cost-bad-method-admin@example.com', 'Org Program Cost Bad Method Admin',
        )

        response = admin_client.post(
            reverse('program-cost-create', args=[program['id']]),
            {
                'organization': str(sponsor_org.id),
                'foncier_total': '1.00',
                'be_total': '1.00',
                'repartition_method': 'methode_inconnue',
                'justification': 'Justification valide.',
            },
            format='json',
        )
        assert response.status_code == 400


@pytest.mark.django_db
class TestProgramCostCurrentAndHistory:
    def test_current_returns_the_latest_revision(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('current')
        admin_client, _admin_org, admin_user = _register_admin(
            'program-cost-current-admin@example.com', 'Org Program Cost Current Admin',
        )

        services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('100.00'), be_total=Decimal('10.00'),
            repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Première estimation.',
        )
        services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('200.00'), be_total=Decimal('20.00'),
            repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Révision après négociation.',
        )

        response = admin_client.get(
            reverse('program-cost-current', args=[program['id']]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 200
        assert Decimal(response.data['foncier_total']) == Decimal('200.00')

    def test_current_is_none_when_no_program_cost_exists_yet(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('current-empty')
        admin_client, _admin_org, _admin_user = _register_admin(
            'program-cost-current-empty-admin@example.com', 'Org Program Cost Current Empty Admin',
        )

        response = admin_client.get(
            reverse('program-cost-current', args=[program['id']]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 200
        assert response.data is None

    def test_history_returns_every_revision_in_chronological_order(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('history')
        admin_client, _admin_org, admin_user = _register_admin(
            'program-cost-history-admin@example.com', 'Org Program Cost History Admin',
        )

        first = services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('100.00'), be_total=Decimal('10.00'),
            repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Première estimation.',
        )
        second = services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('200.00'), be_total=Decimal('20.00'),
            repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Révision.',
        )

        response = admin_client.get(
            reverse('program-cost-history', args=[program['id']]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 200
        ids_in_order = [row['id'] for row in response.data]
        assert ids_in_order == [str(first.id), str(second.id)]


@pytest.mark.django_db
class TestProgramCostImmutability:
    """Même rigueur que `TestPricingConfigImmutability` (ticket 025) —
    tentative EXPLICITE refusée, pas seulement une absence de route.
    """

    def test_no_put_patch_or_delete_method_is_accepted(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('immutable-405')
        admin_client, _admin_org, admin_user = _register_admin(
            'program-cost-405-admin@example.com', 'Org Program Cost 405 Admin',
        )
        program_cost = services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('100.00'), be_total=Decimal('10.00'),
            repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Estimation.',
        )

        url = reverse('program-cost-create', args=[program['id']])
        assert admin_client.put(url, {'foncier_total': '999.00'}, format='json').status_code == 405
        assert admin_client.patch(url, {'foncier_total': '999.00'}, format='json').status_code == 405
        assert admin_client.delete(url).status_code == 405

        # Relecture ORM directe non basculée après une bascule RLS déjà
        # restaurée vers l'admin échouerait silencieusement (piège déjà
        # documenté au ticket 022, CLAUDE.md) — programs_program_cost est
        # scopée organisation (contrairement à pricing_pricingconfig).
        set_rls_context(organization_id=sponsor_org.id)
        program_cost.refresh_from_db()
        assert program_cost.foncier_total == Decimal('100.00')

    def test_direct_sql_update_is_blocked_by_rls_no_policy_defined(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('immutable-sql-update')
        _admin_client, _admin_org, admin_user = _register_admin(
            'program-cost-sql-update-admin@example.com', 'Org Program Cost SQL Update Admin',
        )
        program_cost = services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('100.00'), be_total=Decimal('10.00'),
            repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Estimation.',
        )

        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE programs_program_cost SET foncier_total = %s WHERE id = %s",
                [str(Decimal('999.00')), str(program_cost.id)],
            )
            assert cursor.rowcount == 0

        set_rls_context(organization_id=sponsor_org.id)
        program_cost.refresh_from_db()
        assert program_cost.foncier_total == Decimal('100.00')

    def test_direct_sql_delete_is_blocked_by_rls_no_policy_defined(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('immutable-sql-delete')
        _admin_client, _admin_org, admin_user = _register_admin(
            'program-cost-sql-delete-admin@example.com', 'Org Program Cost SQL Delete Admin',
        )
        program_cost = services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('100.00'), be_total=Decimal('10.00'),
            repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Estimation.',
        )

        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM programs_program_cost WHERE id = %s", [str(program_cost.id)])
            assert cursor.rowcount == 0

        set_rls_context(organization_id=sponsor_org.id)
        assert ProgramCost.objects.filter(id=program_cost.id).exists()

    def test_no_update_or_delete_function_exists_in_the_service_module(self):
        assert not hasattr(services, 'update_program_cost')
        assert not hasattr(services, 'delete_program_cost')


@pytest.mark.django_db
class TestLotRepartition:
    def test_parts_egales_splits_evenly_across_all_lots(self):
        sponsor_org, program, lots = _setup_sponsor_program_with_lots('parts-egales', lot_surfaces=(None, None))
        admin_client, _admin_org, admin_user = _register_admin(
            'program-cost-parts-egales-admin@example.com', 'Org Program Cost Parts Egales Admin',
        )
        services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('100.00'), be_total=Decimal('20.00'),
            repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Deux lots égaux.',
        )

        response = admin_client.get(
            reverse('program-cost-repartition', args=[program['id']]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 200
        assert len(response.data) == 2
        for row in response.data:
            assert Decimal(row['foncier_lot']) == Decimal('50.00')
            assert Decimal(row['be_lot']) == Decimal('10.00')

    def test_prorata_surface_splits_proportionally_to_real_surfaces(self):
        """Surfaces DIFFÉRENTES (pas égales) — preuve que la proportion est
        réellement calculée, pas une coïncidence avec parts_egales.
        """
        sponsor_org, program, lots = _setup_sponsor_program_with_lots(
            'prorata', lot_surfaces=(Decimal('100.00'), Decimal('300.00')),
        )
        admin_client, _admin_org, admin_user = _register_admin(
            'program-cost-prorata-admin@example.com', 'Org Program Cost Prorata Admin',
        )
        services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('400.00'), be_total=Decimal('40.00'),
            repartition_method=ProgramCostRepartitionMethod.PRORATA_SURFACE,
            justification='Répartition proportionnelle aux surfaces réelles.',
        )

        response = admin_client.get(
            reverse('program-cost-repartition', args=[program['id']]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 200
        rows_by_lot_id = {row['lot_id']: row for row in response.data}

        small_lot_row = rows_by_lot_id[lots[0]['id']]
        big_lot_row = rows_by_lot_id[lots[1]['id']]
        # 100/(100+300) = 25% ; 300/(100+300) = 75%
        assert Decimal(small_lot_row['foncier_lot']) == Decimal('100.00')
        assert Decimal(small_lot_row['be_lot']) == Decimal('10.00')
        assert Decimal(big_lot_row['foncier_lot']) == Decimal('300.00')
        assert Decimal(big_lot_row['be_lot']) == Decimal('30.00')

    def test_prorata_surface_is_rejected_explicitly_when_a_lot_has_no_surface(self):
        """Critère d'acceptation central — jamais un partage silencieux à
        zéro pour le lot sans surface.
        """
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots(
            'missing-surface', lot_surfaces=(Decimal('100.00'), None),
        )
        admin_client, _admin_org, admin_user = _register_admin(
            'program-cost-missing-surface-admin@example.com', 'Org Program Cost Missing Surface Admin',
        )
        services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('400.00'), be_total=Decimal('40.00'),
            repartition_method=ProgramCostRepartitionMethod.PRORATA_SURFACE,
            justification='Un lot sans surface — doit être refusé.',
        )

        response = admin_client.get(
            reverse('program-cost-repartition', args=[program['id']]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 409

    def test_repartition_response_is_a_list_indexed_by_lot_never_an_aggregated_object(self):
        """Précision explicite de l'utilisateur (décision D) — testée
        directement sur la FORME de la réponse.
        """
        sponsor_org, program, lots = _setup_sponsor_program_with_lots('shape', lot_surfaces=(None, None))
        admin_client, _admin_org, admin_user = _register_admin(
            'program-cost-shape-admin@example.com', 'Org Program Cost Shape Admin',
        )
        services.create_program_cost(
            admin=admin_user, admin_organization_id=_admin_org.id, target_organization_id=sponsor_org.id,
            program_id=program['id'], foncier_total=Decimal('100.00'), be_total=Decimal('10.00'),
            repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Forme de la réponse.',
        )

        response = admin_client.get(
            reverse('program-cost-repartition', args=[program['id']]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 200
        assert isinstance(response.data, list)
        assert len(response.data) == 2
        expected_lot_ids = {lot['id'] for lot in lots}
        for row in response.data:
            assert set(row.keys()) == {'lot_id', 'foncier_lot', 'be_lot'}
            assert row['lot_id'] in expected_lot_ids

    def test_repartition_is_rejected_explicitly_when_no_program_cost_exists_yet(self):
        sponsor_org, program, _lots = _setup_sponsor_program_with_lots('no-cost')
        admin_client, _admin_org, _admin_user = _register_admin(
            'program-cost-no-cost-admin@example.com', 'Org Program Cost No Cost Admin',
        )

        response = admin_client.get(
            reverse('program-cost-repartition', args=[program['id']]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 409


@pytest.mark.django_db(transaction=True)
class TestProgramCostSequenceForcedCollision:
    """Ticket B-033 — même méthode que le ticket B-031 : `sequence`
    construit dès la conception de ce modèle, prouvé par une collision
    FORCÉE de `created_at` (jamais un espoir de reproduction hasardeuse).
    `django_db(transaction=True)` requis pour `_register_admin`/
    `_setup_sponsor_program_with_lots` qui passent par de vraies requêtes
    HTTP (même piège déjà documenté au ticket B-031 : `set_rls_context`
    n'a d'effet réel qu'à l'intérieur d'un `transaction.atomic()` explicite
    sous ce mode — tout le setup est donc posé dans son propre bloc).
    """

    def test_two_program_costs_with_an_identical_created_at_are_resolved_by_sequence(self):
        with transaction.atomic():
            sponsor_org, program, _lots = _setup_sponsor_program_with_lots('tiebreak')
            admin_client, admin_org, admin_user = _register_admin(
                'program-cost-tiebreak-admin@example.com', 'Org Program Cost Tiebreak Admin',
            )

            frozen_now = timezone.now()
            with mock.patch('django.utils.timezone.now', return_value=frozen_now):
                first = services.create_program_cost(
                    admin=admin_user, admin_organization_id=admin_org.id, target_organization_id=sponsor_org.id,
                    program_id=program['id'], foncier_total=Decimal('100.00'), be_total=Decimal('10.00'),
                    repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Première.',
                )
                second = services.create_program_cost(
                    admin=admin_user, admin_organization_id=admin_org.id, target_organization_id=sponsor_org.id,
                    program_id=program['id'], foncier_total=Decimal('200.00'), be_total=Decimal('20.00'),
                    repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES, justification='Seconde, même instant.',
                )

            assert first.created_at == second.created_at
            assert second.sequence > first.sequence

            current = services.get_current_program_cost(
                admin_organization_id=admin_org.id, target_organization_id=sponsor_org.id,
                program_id=program['id'],
            )
            assert current.id == second.id
            assert current.foncier_total == Decimal('200.00')


@pytest.mark.django_db
class TestProgramAssetLotAdminGatekeeping:
    """Ticket B-039 — KEYIMMO est le gatekeeper de l'introduction des
    programmes immobiliers : `admin_keyimmo` seul peut créer/modifier/
    supprimer `Program`/`Asset`/`Lot`, sans jamais avoir besoin d'un
    `Membership` réel dans l'organisation cible (capacité transverse, voir
    `apps.backoffice.permissions.IsAdminKeyimmo`). Les autres organisations
    restent en lecture seule (`list`/`retrieve`/`hierarchy`), comportement
    strictement inchangé par ce ticket.
    """

    def test_an_ordinary_member_cannot_write_a_program_asset_or_lot_by_any_route(self):
        member_client = _register_and_authenticate(
            'gatekeeping-member@example.com', 'Org Gatekeeping Member',
        )
        organization = Organization.objects.get(name='Org Gatekeeping Member')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization.id, 'Programme Gatekeeping')
        asset = _create_asset(admin_client, organization.id, program['id'], 'Bien Gatekeeping')
        lot = _create_lot(admin_client, organization.id, asset['id'], 'Lot Gatekeeping')

        # create — les trois ressources, tentées depuis l'organisation
        # membre elle-même (celle qui possède réellement ces objets).
        assert member_client.post(
            reverse('program-list'), {'organization': str(organization.id), 'name': 'Intrus'}, format='json',
        ).status_code == 403
        assert member_client.post(
            reverse('asset-list'),
            {'organization': str(organization.id), 'program': program['id'], 'name': 'Intrus'}, format='json',
        ).status_code == 403
        assert member_client.post(
            reverse('lot-list'),
            {'organization': str(organization.id), 'asset': asset['id'], 'name': 'Intrus'}, format='json',
        ).status_code == 403

        # update (PATCH)
        assert member_client.patch(
            reverse('program-detail', args=[program['id']]), {'name': 'Renommé'}, format='json',
        ).status_code == 403
        assert member_client.patch(
            reverse('asset-detail', args=[asset['id']]), {'name': 'Renommé'}, format='json',
        ).status_code == 403
        assert member_client.patch(
            reverse('lot-detail', args=[lot['id']]), {'name': 'Renommé'}, format='json',
        ).status_code == 403

        # destroy
        assert member_client.delete(reverse('program-detail', args=[program['id']])).status_code == 403
        assert member_client.delete(reverse('asset-detail', args=[asset['id']])).status_code == 403
        assert member_client.delete(reverse('lot-detail', args=[lot['id']])).status_code == 403

        # Rien n'a été altéré malgré ces tentatives.
        assert Program.objects.get(id=program['id']).name == 'Programme Gatekeeping'
        assert Asset.objects.get(id=asset['id']).name == 'Bien Gatekeeping'
        assert Lot.objects.get(id=lot['id']).name == 'Lot Gatekeeping'

    def test_admin_keyimmo_can_write_for_an_organization_where_he_has_no_membership_at_all(self):
        organization = Organization.objects.create(
            name='Org Sans Membership Admin', country_pack=CountryPack.objects.get(code='SN'),
        )
        admin_client, _admin_org, admin_user = _register_admin(
            'gatekeeping-admin@example.com', 'Org Gatekeeping Admin',
        )
        assert not Membership.objects.filter(user=admin_user, organization=organization).exists()

        program = _create_program(admin_client, organization.id, 'Programme Distant')
        assert 'id' in program, program
        asset = _create_asset(admin_client, organization.id, program['id'], 'Bien Distant')
        lot = _create_lot(admin_client, organization.id, asset['id'], 'Lot Distant', surface=Decimal('80.00'))

        # Bascule RLS explicite vers l'organisation cible : chaque appel
        # `services.create_*` ci-dessus restaure le contexte RLS de
        # l'admin dans son `finally` (ticket B-039) — une relecture ORM
        # directe non basculée échouerait silencieusement (piège déjà
        # documenté, voir TestProgramCostImmutability plus haut).
        set_rls_context(organization_id=organization.id)
        assert Program.objects.filter(id=program['id'], organization=organization).exists()
        assert Asset.objects.filter(id=asset['id'], organization=organization).exists()
        assert Lot.objects.filter(id=lot['id'], organization=organization).exists()
        # Les jalons sont bien instanciés — `services.create_lot` appelle
        # `instantiate_milestones_for_lot`, comme l'ancien `perform_create`.
        assert Lot.objects.get(id=lot['id']).milestones.exists()

        query = f'?organization_id={organization.id}'
        assert admin_client.patch(
            reverse('program-detail', args=[program['id']]) + query,
            {'name': 'Programme Distant Renommé'}, format='json',
        ).status_code == 200
        assert admin_client.patch(
            reverse('asset-detail', args=[asset['id']]) + query,
            {'name': 'Bien Distant Renommé'}, format='json',
        ).status_code == 200
        assert admin_client.patch(
            reverse('lot-detail', args=[lot['id']]) + query,
            {'surface': '95.50'}, format='json',
        ).status_code == 200

        assert admin_client.delete(reverse('lot-detail', args=[lot['id']]) + query).status_code == 204
        assert admin_client.delete(reverse('asset-detail', args=[asset['id']]) + query).status_code == 204
        assert admin_client.delete(reverse('program-detail', args=[program['id']]) + query).status_code == 204

        set_rls_context(organization_id=organization.id)
        assert not Program.objects.filter(id=program['id']).exists()
        # Aucun Membership n'a jamais été créé pour permettre tout ceci —
        # la capacité transverse d'admin_keyimmo est la seule en jeu.
        assert not Membership.objects.filter(user=admin_user, organization=organization).exists()

    def test_write_without_organization_id_query_param_is_rejected_on_update_and_destroy(self):
        """`organization_id` ne peut pas être dérivé après coup depuis
        `pk` seul (même piège que `create_program_cost`, voir B-039) — un
        appel qui l'omet doit échouer explicitement, jamais deviner.
        """
        organization = Organization.objects.create(
            name='Org Query Param Requis', country_pack=CountryPack.objects.get(code='SN'),
        )
        admin_client, _admin_org, _admin_user = _register_admin(
            'gatekeeping-queryparam-admin@example.com', 'Org Gatekeeping Query Param Admin',
        )
        program = _create_program(admin_client, organization.id, 'Programme Sans Query Param')

        assert admin_client.patch(
            reverse('program-detail', args=[program['id']]), {'name': 'Peu importe'}, format='json',
        ).status_code == 400
        assert admin_client.delete(reverse('program-detail', args=[program['id']])).status_code == 400

    def test_read_access_for_ordinary_members_is_unchanged(self):
        member_client = _register_and_authenticate(
            'gatekeeping-read@example.com', 'Org Gatekeeping Read',
        )
        organization = Organization.objects.get(name='Org Gatekeeping Read')
        admin_client = _any_admin_client()
        program = _create_program(admin_client, organization.id, 'Programme Lecture')
        _asset = _create_asset(admin_client, organization.id, program['id'], 'Bien Lecture')

        assert member_client.get(reverse('program-list')).status_code == 200
        assert member_client.get(reverse('program-detail', args=[program['id']])).status_code == 200
        assert member_client.get(reverse('program-hierarchy', args=[program['id']])).status_code == 200


@pytest.mark.django_db
class TestLotCommercialFieldsGatekeeping:
    """Ticket B-042 — `commercial_status`/`sale_price` suivent le même
    verrou que `name`/`surface` (ticket B-039) : écriture réservée à
    `admin_keyimmo`, même chemin de mutation (`LotViewSet.update`)."""

    def test_admin_keyimmo_can_set_commercial_status_and_sale_price(self):
        sponsor_org, _program, lots = _setup_sponsor_program_with_lots('commercial-admin')
        lot = lots[0]
        admin_client = _any_admin_client()

        response = admin_client.patch(
            reverse('lot-detail', args=[lot['id']]) + f'?organization_id={sponsor_org.id}',
            {'commercial_status': 'reserve', 'sale_price': '25000000.00'}, format='json',
        )

        assert response.status_code == 200
        assert response.data['commercial_status'] == 'reserve'
        assert response.data['sale_price'] == '25000000.00'

    def test_an_ordinary_member_cannot_set_commercial_status_or_sale_price(self):
        sponsor_org, _program, lots = _setup_sponsor_program_with_lots('commercial-member')
        lot = lots[0]
        member_client = _register_and_authenticate(
            'commercial-member-user@example.com', 'Org Commercial Member User',
        )

        response = member_client.patch(
            reverse('lot-detail', args=[lot['id']]) + f'?organization_id={sponsor_org.id}',
            {'commercial_status': 'vendu'}, format='json',
        )

        assert response.status_code == 403
        # Piège RLS déjà documenté (CLAUDE.md, ticket B-039) : une lecture
        # ORM directe après un appel admin doit re-basculer explicitement
        # le contexte RLS, sinon échec silencieux (queryset vide).
        set_rls_context(organization_id=sponsor_org.id)
        assert Lot.objects.get(id=lot['id']).commercial_status == 'disponible'

    def test_an_invalid_commercial_status_is_rejected(self):
        sponsor_org, _program, lots = _setup_sponsor_program_with_lots('commercial-invalid')
        lot = lots[0]
        admin_client = _any_admin_client()

        response = admin_client.patch(
            reverse('lot-detail', args=[lot['id']]) + f'?organization_id={sponsor_org.id}',
            {'commercial_status': 'pas-un-statut-valide'}, format='json',
        )

        assert response.status_code == 400
        set_rls_context(organization_id=sponsor_org.id)
        assert Lot.objects.get(id=lot['id']).commercial_status == 'disponible'

    def test_a_new_lot_defaults_to_disponible(self):
        sponsor_org, _program, lots = _setup_sponsor_program_with_lots('commercial-default')
        set_rls_context(organization_id=sponsor_org.id)
        assert Lot.objects.get(id=lots[0]['id']).commercial_status == 'disponible'
        assert Lot.objects.get(id=lots[0]['id']).sale_price is None


@pytest.mark.django_db
class TestProgramRequest:
    """Ticket B-042 — demande de programme sur mesure : n'importe quel
    utilisateur authentifié soumet une demande pour SA PROPRE organisation
    active, `admin_keyimmo` seul peut lister toutes les demandes (toutes
    organisations confondues) et les accepter/refuser. Ne crée JAMAIS de
    `Program` — le verrou KEYIMMO gatekeeper (ticket B-039) reste intact.
    """

    def test_a_user_can_create_a_request_for_their_own_active_organization(self):
        client = _register_and_authenticate('request-owner@example.com', 'Org Request Owner')
        organization = Organization.objects.get(name='Org Request Owner')

        response = client.post(
            reverse('program-request-list-create'),
            {'description': 'Villa 4 pièces à Dakar, budget indicatif 60M FCFA.'}, format='json',
        )

        assert response.status_code == 201
        assert response.data['organization'] == organization.id
        assert response.data['status'] == 'en_attente'
        assert response.data['program'] is None

    def test_an_empty_description_is_rejected(self):
        client = _register_and_authenticate('request-empty@example.com', 'Org Request Empty')

        response = client.post(reverse('program-request-list-create'), {'description': '   '}, format='json')

        assert response.status_code == 400
        assert not ProgramRequest.objects.exists()

    def test_a_user_only_sees_their_own_organizations_requests(self):
        client_a = _register_and_authenticate('request-a@example.com', 'Org Request A')
        client_a.post(
            reverse('program-request-list-create'), {'description': 'Demande A'}, format='json',
        )
        client_b = _register_and_authenticate('request-b@example.com', 'Org Request B')
        client_b.post(
            reverse('program-request-list-create'), {'description': 'Demande B'}, format='json',
        )

        response = client_a.get(reverse('program-request-mine'))

        assert response.status_code == 200
        descriptions = [row['description'] for row in response.data]
        assert descriptions == ['Demande A']

    def test_an_ordinary_member_cannot_list_all_requests_across_organizations(self):
        member_client = _register_and_authenticate(
            'request-noadmin@example.com', 'Org Request No Admin',
        )
        response = member_client.get(reverse('program-request-list-create'))
        assert response.status_code == 403

    def test_admin_keyimmo_lists_requests_across_organizations_without_membership(self):
        client_a = _register_and_authenticate('request-cross-a@example.com', 'Org Request Cross A')
        client_a.post(
            reverse('program-request-list-create'), {'description': 'Demande cross A'}, format='json',
        )
        client_b = _register_and_authenticate('request-cross-b@example.com', 'Org Request Cross B')
        client_b.post(
            reverse('program-request-list-create'), {'description': 'Demande cross B'}, format='json',
        )
        admin_client, _admin_org, admin_user = _register_admin(
            'request-cross-admin@example.com', 'Org Request Cross Admin',
        )
        org_a = Organization.objects.get(name='Org Request Cross A')
        org_b = Organization.objects.get(name='Org Request Cross B')
        assert not Membership.objects.filter(user=admin_user, organization__in=[org_a, org_b]).exists()

        response = admin_client.get(reverse('program-request-list-create'))

        assert response.status_code == 200
        organization_names = {row['organization_name'] for row in response.data}
        assert {'Org Request Cross A', 'Org Request Cross B'}.issubset(organization_names)

    def test_admin_keyimmo_can_filter_requests_by_status(self):
        client = _register_and_authenticate('request-filter@example.com', 'Org Request Filter')
        created = client.post(
            reverse('program-request-list-create'), {'description': 'À filtrer'}, format='json',
        ).data
        admin_client = _any_admin_client()
        organization = Organization.objects.get(name='Org Request Filter')
        admin_client.post(
            reverse('program-request-decide', args=[created['id']]) + f'?organization_id={organization.id}',
            {'status': 'acceptee'}, format='json',
        )

        pending = admin_client.get(reverse('program-request-list-create') + '?status=en_attente')
        accepted = admin_client.get(reverse('program-request-list-create') + '?status=acceptee')

        assert all(row['id'] != created['id'] for row in pending.data)
        assert any(row['id'] == created['id'] for row in accepted.data)

    def test_admin_keyimmo_can_accept_a_request_without_creating_a_program(self):
        client = _register_and_authenticate('request-accept@example.com', 'Org Request Accept')
        organization = Organization.objects.get(name='Org Request Accept')
        created = client.post(
            reverse('program-request-list-create'), {'description': 'À accepter'}, format='json',
        ).data
        admin_client = _any_admin_client()

        response = admin_client.post(
            reverse('program-request-decide', args=[created['id']]) + f'?organization_id={organization.id}',
            {'status': 'acceptee'}, format='json',
        )

        assert response.status_code == 200
        assert response.data['status'] == 'acceptee'
        assert response.data['program'] is None
        # Verrou B-039 intact : accepter une demande ne crée jamais de
        # Program automatiquement, admin_keyimmo le fait séparément via
        # le wizard existant (ticket F-049).
        set_rls_context(organization_id=organization.id)
        assert not Program.objects.filter(organization=organization).exists()

    def test_admin_keyimmo_can_refuse_a_request(self):
        client = _register_and_authenticate('request-refuse@example.com', 'Org Request Refuse')
        organization = Organization.objects.get(name='Org Request Refuse')
        created = client.post(
            reverse('program-request-list-create'), {'description': 'À refuser'}, format='json',
        ).data
        admin_client = _any_admin_client()

        response = admin_client.post(
            reverse('program-request-decide', args=[created['id']]) + f'?organization_id={organization.id}',
            {'status': 'refusee'}, format='json',
        )

        assert response.status_code == 200
        assert response.data['status'] == 'refusee'

    def test_an_ordinary_member_cannot_decide_on_a_request(self):
        client = _register_and_authenticate('request-nodecide@example.com', 'Org Request No Decide')
        organization = Organization.objects.get(name='Org Request No Decide')
        created = client.post(
            reverse('program-request-list-create'), {'description': 'Pas décidable'}, format='json',
        ).data

        response = client.post(
            reverse('program-request-decide', args=[created['id']]) + f'?organization_id={organization.id}',
            {'status': 'acceptee'}, format='json',
        )

        assert response.status_code == 403
        assert ProgramRequest.objects.get(id=created['id']).status == 'en_attente'

    def test_decide_without_organization_id_query_param_is_rejected(self):
        client = _register_and_authenticate('request-noqp@example.com', 'Org Request No QP')
        created = client.post(
            reverse('program-request-list-create'), {'description': 'Sans query param'}, format='json',
        ).data
        admin_client = _any_admin_client()

        response = admin_client.post(
            reverse('program-request-decide', args=[created['id']]), {'status': 'acceptee'}, format='json',
        )

        assert response.status_code == 400

    def test_an_invalid_decision_status_is_rejected(self):
        client = _register_and_authenticate('request-badstatus@example.com', 'Org Request Bad Status')
        organization = Organization.objects.get(name='Org Request Bad Status')
        created = client.post(
            reverse('program-request-list-create'), {'description': 'Statut invalide'}, format='json',
        ).data
        admin_client = _any_admin_client()

        response = admin_client.post(
            reverse('program-request-decide', args=[created['id']]) + f'?organization_id={organization.id}',
            {'status': 'en_attente'}, format='json',
        )

        assert response.status_code == 400
