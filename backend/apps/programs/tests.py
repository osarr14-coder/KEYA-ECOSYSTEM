from pathlib import Path

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.organizations.models import CountryPack

from .models import Asset, Lot, MilestoneTemplate, MilestoneTemplateStep, Program

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

    def test_new_lot_gets_milestones_from_active_senegal_template(self):
        client = _register_and_authenticate('sponsor1@example.com', 'Org Jalons 1')
        program = _create_program(client)
        asset = _create_asset(client, program['id'])

        lot = _create_lot(client, asset['id'])

        response = client.get(reverse('lot-detail', args=[lot['id']]))
        assert response.status_code == 200

        hierarchy = client.get(reverse('program-hierarchy', args=[program['id']])).data
        milestones = hierarchy['assets'][0]['lots'][0]['milestones']
        codes = [m['code'] for m in milestones]
        assert codes == [
            'foncier', 'conception', 'fondations', 'gros_oeuvre',
            'second_oeuvre', 'finitions', 'reception', 'livraison',
        ]

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


class TestNoHardcodedMilestoneNames:
    """Ticket 002 — critère d'acceptation : aucun nom de jalon en dur dans le
    code métier. Les noms de jalons Sénégal n'existent que dans la migration
    de seed (une donnée), jamais dans models/services/serializers/views.
    """

    BUSINESS_CODE_FILES = ['models.py', 'services.py', 'serializers.py', 'views.py']

    # Doit correspondre aux codes de
    # migrations/0003_seed_senegal_milestone_template.py — dupliqué
    # volontairement ici plutôt qu'importé : une migration est un
    # enregistrement historique, pas un module à réutiliser en dehors de
    # Django lui-même.
    SENEGAL_MILESTONE_CODES = [
        'foncier', 'conception', 'fondations', 'gros_oeuvre',
        'second_oeuvre', 'finitions', 'reception', 'livraison',
    ]

    def test_no_business_code_file_references_a_senegal_milestone_code(self):
        app_dir = Path(__file__).parent
        offending = []
        for filename in self.BUSINESS_CODE_FILES:
            content = (app_dir / filename).read_text(encoding='utf-8')
            for code in self.SENEGAL_MILESTONE_CODES:
                if code in content:
                    offending.append((filename, code))

        assert offending == [], (
            f'Des noms de jalons Sénégal sont codés en dur hors des migrations : {offending}'
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
class TestProgramCrudIsOrganizationScoped:
    """Complète la couverture RLS du ticket 001 pour les nouvelles tables
    scopées par organisation introduites par ce ticket.
    """

    def test_program_of_another_organization_is_not_visible(self):
        client_a = _register_and_authenticate('proga@example.com', 'Org Prog A')
        program_a = _create_program(client_a, name='Programme A')

        client_b = _register_and_authenticate('progb@example.com', 'Org Prog B')

        response = client_b.get(reverse('program-detail', args=[program_a['id']]))
        assert response.status_code == 404

        list_response = client_b.get(reverse('program-list'))
        program_ids = [p['id'] for p in list_response.data]
        assert program_a['id'] not in program_ids
