from decimal import Decimal

import pytest
from django.db import connection
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Membership, Organization, Role

from . import services
from .models import PricingCanal, PricingConfig

PASSWORD = 'strongpass123'


def _register(email, organization_name, role_code='sponsor'):
    """Même helper que les autres modules de test de ce projet — dupliqué
    volontairement (discipline déjà assumée, voir apps/procurement/tests.py).
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


@pytest.mark.django_db
class TestPricingConfigCreation:
    def test_admin_keyimmo_can_create_a_pricing_config(self):
        admin_client, _admin_org, admin_user = _register_admin(
            'pricing-create-admin@example.com', 'Org Pricing Create Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        response = admin_client.post(
            reverse('pricing-config-create'),
            {
                'country_pack': str(senegal.id),
                'canal': PricingCanal.CANAL_1_MARGE,
                'rate': '12.50',
            },
            format='json',
        )
        assert response.status_code == 201, response.data
        assert Decimal(response.data['rate']) == Decimal('12.50')
        assert response.data['canal'] == PricingCanal.CANAL_1_MARGE
        assert response.data['created_by'] == admin_user.id

    def test_a_constructeur_cannot_create_a_pricing_config(self):
        constructeur_client, _org, _user = _register_constructeur(
            'pricing-create-forbidden@example.com', 'Org Pricing Create Forbidden',
        )
        senegal = CountryPack.objects.get(code='SN')

        response = constructeur_client.post(
            reverse('pricing-config-create'),
            {
                'country_pack': str(senegal.id),
                'canal': PricingCanal.CANAL_1_MARGE,
                'rate': '12.50',
            },
            format='json',
        )
        assert response.status_code == 403

    def test_a_second_pricing_config_for_the_same_country_pack_and_canal_does_not_touch_the_first(self):
        admin_client, _admin_org, admin_user = _register_admin(
            'pricing-second-admin@example.com', 'Org Pricing Second Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        first = services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_1_MARGE, rate=Decimal('10.00'),
        )
        response = admin_client.post(
            reverse('pricing-config-create'),
            {
                'country_pack': str(senegal.id),
                'canal': PricingCanal.CANAL_1_MARGE,
                'rate': '15.00',
            },
            format='json',
        )
        assert response.status_code == 201, response.data

        first.refresh_from_db()
        assert first.rate == Decimal('10.00')
        assert PricingConfig.objects.filter(
            country_pack=senegal, canal=PricingCanal.CANAL_1_MARGE,
        ).count() == 2


@pytest.mark.django_db
class TestPricingConfigCurrentAndHistory:
    def test_current_returns_the_latest_rate_per_canal(self):
        admin_client, _admin_org, admin_user = _register_admin(
            'pricing-current-admin@example.com', 'Org Pricing Current Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_1_MARGE, rate=Decimal('10.00'),
        )
        services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_1_MARGE, rate=Decimal('20.00'),
        )
        services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_2_COMMISSION, rate=Decimal('5.00'),
        )

        response = admin_client.get(
            reverse('pricing-config-current'), {'country_pack_id': str(senegal.id)},
        )
        assert response.status_code == 200
        assert Decimal(response.data[PricingCanal.CANAL_1_MARGE]['rate']) == Decimal('20.00')
        assert Decimal(response.data[PricingCanal.CANAL_2_COMMISSION]['rate']) == Decimal('5.00')

    def test_current_is_none_for_a_canal_with_no_pricing_config_yet(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'pricing-current-empty-admin@example.com', 'Org Pricing Current Empty Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        response = admin_client.get(
            reverse('pricing-config-current'), {'country_pack_id': str(senegal.id)},
        )
        assert response.status_code == 200
        assert response.data[PricingCanal.CANAL_1_MARGE] is None
        assert response.data[PricingCanal.CANAL_2_COMMISSION] is None

    def test_history_returns_every_record_in_chronological_order(self):
        admin_client, _admin_org, admin_user = _register_admin(
            'pricing-history-admin@example.com', 'Org Pricing History Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        first = services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_1_MARGE, rate=Decimal('10.00'),
        )
        second = services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_1_MARGE, rate=Decimal('20.00'),
        )
        third = services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_1_MARGE, rate=Decimal('15.00'),
        )

        response = admin_client.get(
            reverse('pricing-config-history'),
            {'country_pack_id': str(senegal.id), 'canal': PricingCanal.CANAL_1_MARGE},
        )
        assert response.status_code == 200
        ids_in_order = [row['id'] for row in response.data]
        assert ids_in_order == [str(first.id), str(second.id), str(third.id)]
        rates_in_order = [Decimal(row['rate']) for row in response.data]
        assert rates_in_order == [Decimal('10.00'), Decimal('20.00'), Decimal('15.00')]
        # "Ancien taux" du changement second->third se lit en comparant
        # deux entrées consécutives, jamais un champ dédié.
        assert rates_in_order[1] != rates_in_order[2]

    def test_a_constructeur_cannot_read_current_or_history(self):
        constructeur_client, _org, _user = _register_constructeur(
            'pricing-read-forbidden@example.com', 'Org Pricing Read Forbidden',
        )
        senegal = CountryPack.objects.get(code='SN')

        current_response = constructeur_client.get(
            reverse('pricing-config-current'), {'country_pack_id': str(senegal.id)},
        )
        assert current_response.status_code == 403

        history_response = constructeur_client.get(
            reverse('pricing-config-history'),
            {'country_pack_id': str(senegal.id), 'canal': PricingCanal.CANAL_1_MARGE},
        )
        assert history_response.status_code == 403


@pytest.mark.django_db
class TestPricingConfigImmutability:
    """Cœur du ticket : même rigueur que l'append-only `TrustEvent`/`Devis`
    (tickets 003/022) — vérifié comme une tentative EXPLICITE refusée, pas
    seulement par absence de route (demande explicite de l'utilisateur).
    """

    def test_no_put_patch_or_delete_method_is_accepted_on_the_create_endpoint(self):
        """Tentative HTTP explicite, pas une simple absence de route dans
        `urls.py` : `PricingConfigCreateView` ne définit que `post` —
        DRF renvoie 405 pour toute autre méthode, prouvant qu'aucun
        mécanisme de mutation n'est accessible par ce chemin, même
        accidentellement.
        """
        admin_client, _admin_org, admin_user = _register_admin(
            'pricing-405-admin@example.com', 'Org Pricing 405 Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        pricing_config = services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_1_MARGE, rate=Decimal('10.00'),
        )

        url = reverse('pricing-config-create')
        assert admin_client.put(url, {'rate': '999.99'}, format='json').status_code == 405
        assert admin_client.patch(url, {'rate': '999.99'}, format='json').status_code == 405
        assert admin_client.delete(url).status_code == 405

        pricing_config.refresh_from_db()
        assert pricing_config.rate == Decimal('10.00')

    def test_direct_sql_update_is_blocked_by_rls_no_policy_defined(self):
        """Aucune policy RLS `UPDATE` n'est définie sur
        `pricing_pricingconfig` (migration `0002_pricingconfig_rls.py`) —
        sous `FORCE ROW LEVEL SECURITY`, ceci bloque TOUT `UPDATE` par
        défaut, y compris pour le rôle propriétaire de la table. Même
        discipline que `TrustEvent` (ticket 003) : une tentative en SQL
        BRUT affecte silencieusement 0 ligne, sans lever d'exception — le
        test vérifie `cursor.rowcount == 0` + donnée inchangée après
        relecture, pas une erreur levée.
        """
        _admin_client, _admin_org, admin_user = _register_admin(
            'pricing-sql-update-admin@example.com', 'Org Pricing SQL Update Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        pricing_config = services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_1_MARGE, rate=Decimal('10.00'),
        )

        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE pricing_pricingconfig SET rate = %s WHERE id = %s",
                [str(Decimal('999.99')), str(pricing_config.id)],
            )
            assert cursor.rowcount == 0

        pricing_config.refresh_from_db()
        assert pricing_config.rate == Decimal('10.00')

    def test_direct_sql_delete_is_blocked_by_rls_no_policy_defined(self):
        """Même raisonnement que le test précédent, pour DELETE."""
        _admin_client, _admin_org, admin_user = _register_admin(
            'pricing-sql-delete-admin@example.com', 'Org Pricing SQL Delete Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        pricing_config = services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_1_MARGE, rate=Decimal('10.00'),
        )

        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM pricing_pricingconfig WHERE id = %s", [str(pricing_config.id)])
            assert cursor.rowcount == 0

        assert PricingConfig.objects.filter(id=pricing_config.id).exists()

    def test_no_update_or_delete_function_exists_in_the_service_module(self):
        """Layer applicatif, en plus de la garde RLS — même famille que
        `apps.trust.repository`, qui n'expose et ne doit jamais exposer de
        fonction `update`/`delete` (ticket 003, vérifié par `hasattr`).
        """
        assert not hasattr(services, 'update_pricing_config')
        assert not hasattr(services, 'delete_pricing_config')

    def test_all_registered_routes_for_this_module_accept_no_mutation_method(self):
        """Liste EXACTE des routes du module — toute route future ajoutée
        sans mise à jour consciente de ce test le fait échouer, même
        famille de garde que les modules précédents (`apps.backoffice`,
        `apps.procurement`).
        """
        from apps.pricing.urls import urlpatterns
        names = {pattern.name for pattern in urlpatterns}
        assert names == {'pricing-config-create', 'pricing-config-current', 'pricing-config-history'}
