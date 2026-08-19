import threading
from decimal import Decimal
from itertools import count
from unittest import mock

import pytest
from django.db import IntegrityError, connection, transaction
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Membership, Organization, Role

from . import services
from .models import ActiveLegalPaymentTierTemplate, LegalPaymentTierTemplate, PricingCanal, PricingConfig

PASSWORD = 'strongpass123'

SENEGAL_TIER_STEPS = [
    {
        'order': 1, 'code': 'reservation', 'label': 'Réservation',
        'cumulative_cap_percent': Decimal('35.00'), 'allows_progressive_payments': False,
    },
    {
        'order': 2, 'code': 'achevement_fondations', 'label': 'Achèvement fondations',
        'cumulative_cap_percent': Decimal('70.00'), 'allows_progressive_payments': True,
    },
    {
        'order': 3, 'code': 'achevement_gros_oeuvre', 'label': 'Achèvement gros œuvre',
        'cumulative_cap_percent': Decimal('95.00'), 'allows_progressive_payments': True,
    },
    {
        'order': 4, 'code': 'livraison', 'label': 'Livraison',
        'cumulative_cap_percent': Decimal('100.00'), 'allows_progressive_payments': False,
    },
]


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
        `apps.procurement`). Mise à jour ticket B-027 : 4 nouvelles routes
        `legal-payment-tier-template-*` ajoutées à la liste.
        """
        from apps.pricing.urls import urlpatterns
        names = {pattern.name for pattern in urlpatterns}
        assert names == {
            'pricing-config-create', 'pricing-config-current', 'pricing-config-history',
            'legal-payment-tier-template-create', 'legal-payment-tier-template-activate',
            'legal-payment-tier-template-active', 'legal-payment-tier-template-history',
        }


@pytest.mark.django_db
class TestLegalPaymentTierStepImmutability:
    """Cœur de la migration `0004_legal_payment_tier_step_rls.py` — même
    rigueur que `TestPricingConfigImmutability` (ticket 025), appliquée
    UNIQUEMENT à `LegalPaymentTierStep` (jamais à `LegalPaymentTierTemplate`
    ni `ActiveLegalPaymentTierTemplate`, qui ont un besoin de mutation
    légitime — voir la migration pour le raisonnement complet).
    """

    def test_direct_sql_update_on_a_step_is_blocked_by_rls_no_policy_defined(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-step-sql-update-admin@example.com', 'Org Tier Step SQL Update Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        template = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )
        step = template.steps.first()

        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE pricing_legal_payment_tier_step SET cumulative_cap_percent = %s WHERE id = %s",
                [str(Decimal('999.99')), str(step.id)],
            )
            assert cursor.rowcount == 0

        step.refresh_from_db()
        assert step.cumulative_cap_percent == SENEGAL_TIER_STEPS[0]['cumulative_cap_percent']

    def test_direct_sql_delete_on_a_step_is_blocked_by_rls_no_policy_defined(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-step-sql-delete-admin@example.com', 'Org Tier Step SQL Delete Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        template = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )
        step = template.steps.first()

        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM pricing_legal_payment_tier_step WHERE id = %s", [str(step.id)])
            assert cursor.rowcount == 0

        assert template.steps.filter(id=step.id).exists()

    def test_no_update_or_delete_function_exists_for_templates_or_steps(self):
        assert not hasattr(services, 'update_legal_payment_tier_template')
        assert not hasattr(services, 'delete_legal_payment_tier_template')
        assert not hasattr(services, 'update_legal_payment_tier_step')
        assert not hasattr(services, 'delete_legal_payment_tier_step')


@pytest.mark.django_db
class TestLegalPaymentTierTemplateCreation:
    def test_admin_keyimmo_can_create_a_draft_template_with_its_steps(self):
        admin_client, _org, admin_user = _register_admin(
            'tier-create-admin@example.com', 'Org Tier Create Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        response = admin_client.post(
            reverse('legal-payment-tier-template-create'),
            {
                'country_pack': str(senegal.id), 'version': 1,
                'steps': [
                    {**step, 'cumulative_cap_percent': str(step['cumulative_cap_percent'])}
                    for step in SENEGAL_TIER_STEPS
                ],
            },
            format='json',
        )
        assert response.status_code == 201, response.data
        assert response.data['created_by'] == admin_user.id
        assert response.data['activated_by'] is None
        assert response.data['activated_at'] is None
        assert len(response.data['steps']) == 4
        assert Decimal(response.data['steps'][-1]['cumulative_cap_percent']) == Decimal('100.00')

    def test_a_constructeur_cannot_create_a_template(self):
        constructeur_client, _org, _user = _register_constructeur(
            'tier-create-forbidden@example.com', 'Org Tier Create Forbidden',
        )
        senegal = CountryPack.objects.get(code='SN')

        response = constructeur_client.post(
            reverse('legal-payment-tier-template-create'),
            {
                'country_pack': str(senegal.id), 'version': 1,
                'steps': [
                    {**step, 'cumulative_cap_percent': str(step['cumulative_cap_percent'])}
                    for step in SENEGAL_TIER_STEPS
                ],
            },
            format='json',
        )
        assert response.status_code == 403

    def test_caps_that_are_not_strictly_increasing_are_rejected_and_nothing_is_created(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-non-increasing-admin@example.com', 'Org Tier Non Increasing Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        steps = [
            {'order': 1, 'code': 'a', 'label': 'A', 'cumulative_cap_percent': Decimal('50.00'), 'allows_progressive_payments': False},
            {'order': 2, 'code': 'b', 'label': 'B', 'cumulative_cap_percent': Decimal('50.00'), 'allows_progressive_payments': False},
            {'order': 3, 'code': 'c', 'label': 'C', 'cumulative_cap_percent': Decimal('100.00'), 'allows_progressive_payments': False},
        ]

        with pytest.raises(Exception):
            services.create_legal_payment_tier_template(
                admin=admin_user, country_pack_id=senegal.id, version=1, steps=steps,
            )

        assert not LegalPaymentTierTemplate.objects.filter(country_pack=senegal, version=1).exists()

    def test_last_cap_at_exactly_100_is_accepted(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-boundary-exact-admin@example.com', 'Org Tier Boundary Exact Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        template = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )
        assert template.steps.count() == 4

    def test_last_cap_below_100_is_rejected(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-boundary-under-admin@example.com', 'Org Tier Boundary Under Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        steps = [
            {'order': 1, 'code': 'a', 'label': 'A', 'cumulative_cap_percent': Decimal('35.00'), 'allows_progressive_payments': False},
            {'order': 2, 'code': 'b', 'label': 'B', 'cumulative_cap_percent': Decimal('99.99'), 'allows_progressive_payments': False},
        ]

        with pytest.raises(Exception):
            services.create_legal_payment_tier_template(
                admin=admin_user, country_pack_id=senegal.id, version=1, steps=steps,
            )
        assert not LegalPaymentTierTemplate.objects.filter(country_pack=senegal, version=1).exists()

    def test_last_cap_above_100_is_rejected(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-boundary-over-admin@example.com', 'Org Tier Boundary Over Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        steps = [
            {'order': 1, 'code': 'a', 'label': 'A', 'cumulative_cap_percent': Decimal('35.00'), 'allows_progressive_payments': False},
            {'order': 2, 'code': 'b', 'label': 'B', 'cumulative_cap_percent': Decimal('100.01'), 'allows_progressive_payments': False},
        ]

        with pytest.raises(Exception):
            services.create_legal_payment_tier_template(
                admin=admin_user, country_pack_id=senegal.id, version=1, steps=steps,
            )
        assert not LegalPaymentTierTemplate.objects.filter(country_pack=senegal, version=1).exists()

    def test_no_steps_is_rejected(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-no-steps-admin@example.com', 'Org Tier No Steps Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        with pytest.raises(Exception):
            services.create_legal_payment_tier_template(
                admin=admin_user, country_pack_id=senegal.id, version=1, steps=[],
            )

    def test_steps_do_not_need_to_arrive_pre_sorted_by_order(self):
        """La validation trie elle-même par `order` — un appelant qui
        envoie les paliers dans le désordre n'est pas pénalisé.
        """
        _admin_client, _org, admin_user = _register_admin(
            'tier-unsorted-admin@example.com', 'Org Tier Unsorted Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        shuffled_steps = [SENEGAL_TIER_STEPS[2], SENEGAL_TIER_STEPS[0], SENEGAL_TIER_STEPS[3], SENEGAL_TIER_STEPS[1]]

        template = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=shuffled_steps,
        )
        ordered_codes = [step.code for step in template.steps.all()]
        assert ordered_codes == ['reservation', 'achevement_fondations', 'achevement_gros_oeuvre', 'livraison']


@pytest.mark.django_db
class TestLegalPaymentTierTemplateUniqueness:
    def test_two_templates_with_the_same_version_for_the_same_country_pack_are_rejected_by_the_db(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-unique-version-admin@example.com', 'Org Tier Unique Version Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                LegalPaymentTierTemplate.objects.create(country_pack=senegal, version=1, created_by=admin_user)

    def test_a_second_country_pack_can_reuse_the_same_version_number(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-unique-cross-pack-admin@example.com', 'Org Tier Unique Cross Pack Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        ivory_coast = CountryPack.objects.create(code='CI', label='Côte d\'Ivoire')

        services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )
        second = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=ivory_coast.id, version=1, steps=SENEGAL_TIER_STEPS,
        )
        assert second.version == 1


@pytest.mark.django_db
class TestLegalPaymentTierTemplateActivation:
    def test_activating_a_draft_sets_activated_by_and_activated_at_and_the_pointer(self):
        admin_client, _org, admin_user = _register_admin(
            'tier-activate-admin@example.com', 'Org Tier Activate Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        template = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )
        assert template.activated_at is None

        response = admin_client.post(
            reverse('legal-payment-tier-template-activate', args=[template.id]),
        )
        assert response.status_code == 200, response.data
        assert response.data['activated_by'] == admin_user.id
        assert response.data['activated_at'] is not None

        active_response = admin_client.get(
            reverse('legal-payment-tier-template-active'), {'country_pack_id': str(senegal.id)},
        )
        assert active_response.status_code == 200
        assert active_response.data['id'] == str(template.id)

    def test_activating_a_new_version_supersedes_the_pointer_without_rewriting_the_old_templates_activation_facts(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-supersede-admin@example.com', 'Org Tier Supersede Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        first = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )
        second = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=2, steps=SENEGAL_TIER_STEPS,
        )

        services.activate_legal_payment_tier_template(admin=admin_user, template_id=first.id)
        first.refresh_from_db()
        first_activated_by, first_activated_at = first.activated_by, first.activated_at

        services.activate_legal_payment_tier_template(admin=admin_user, template_id=second.id)
        first.refresh_from_db()

        assert first.activated_by_id == first_activated_by.id
        assert first.activated_at == first_activated_at

        assert ActiveLegalPaymentTierTemplate.objects.filter(country_pack=senegal).count() == 1
        assert services.get_active_legal_payment_tier_template(senegal.id).id == second.id

    def test_active_is_none_when_nothing_has_ever_been_activated(self):
        admin_client, _org, admin_user = _register_admin(
            'tier-active-empty-admin@example.com', 'Org Tier Active Empty Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        response = admin_client.get(
            reverse('legal-payment-tier-template-active'), {'country_pack_id': str(senegal.id)},
        )
        assert response.status_code == 200
        assert response.data is None

    def test_a_draft_that_was_never_activated_never_shows_up_as_active(self):
        admin_client, _org, admin_user = _register_admin(
            'tier-draft-never-active-admin@example.com', 'Org Tier Draft Never Active Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )

        response = admin_client.get(
            reverse('legal-payment-tier-template-active'), {'country_pack_id': str(senegal.id)},
        )
        assert response.status_code == 200
        assert response.data is None

    def test_allows_progressive_payments_varies_independently_per_step(self):
        _admin_client, _org, admin_user = _register_admin(
            'tier-progressive-per-step-admin@example.com', 'Org Tier Progressive Per Step Admin',
        )
        senegal = CountryPack.objects.get(code='SN')

        template = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )
        flags_by_code = {step.code: step.allows_progressive_payments for step in template.steps.all()}
        assert flags_by_code == {
            'reservation': False, 'achevement_fondations': True,
            'achevement_gros_oeuvre': True, 'livraison': False,
        }
        assert any(flags_by_code.values())
        assert not all(flags_by_code.values())

    def test_history_returns_drafts_and_activated_templates_ordered_by_version(self):
        admin_client, _org, admin_user = _register_admin(
            'tier-history-admin@example.com', 'Org Tier History Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        first = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )
        second = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=2, steps=SENEGAL_TIER_STEPS,
        )
        services.activate_legal_payment_tier_template(admin=admin_user, template_id=first.id)

        response = admin_client.get(
            reverse('legal-payment-tier-template-history'), {'country_pack_id': str(senegal.id)},
        )
        assert response.status_code == 200
        ids_in_order = [row['id'] for row in response.data]
        assert ids_in_order == [str(first.id), str(second.id)]
        assert response.data[0]['activated_at'] is not None
        assert response.data[1]['activated_at'] is None

    def test_a_constructeur_cannot_activate_or_read_active_or_history(self):
        constructeur_client, _org, _user = _register_constructeur(
            'tier-activate-forbidden@example.com', 'Org Tier Activate Forbidden',
        )
        _admin_client, _admin_org, admin_user = _register_admin(
            'tier-activate-forbidden-admin@example.com', 'Org Tier Activate Forbidden Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        template = services.create_legal_payment_tier_template(
            admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
        )

        assert constructeur_client.post(
            reverse('legal-payment-tier-template-activate', args=[template.id]),
        ).status_code == 403
        assert constructeur_client.get(
            reverse('legal-payment-tier-template-active'), {'country_pack_id': str(senegal.id)},
        ).status_code == 403
        assert constructeur_client.get(
            reverse('legal-payment-tier-template-history'), {'country_pack_id': str(senegal.id)},
        ).status_code == 403


@pytest.mark.django_db(transaction=True)
class TestActiveLegalPaymentTierTemplateRaceUnderConcurrency:
    """Décision D-bis (ticket B-027) — même discipline de test que
    `apps.tasks.tests.TestTaskCreationRaceUnderConcurrency` (ticket 017) :
    deux VRAIES transactions concurrentes (deux threads, deux connexions),
    synchronisées par une barrière pour garantir que les DEUX lisent
    « aucun pointeur n'existe encore » AVANT qu'aucune n'écrive — jamais un
    `sleep` hasardeux. Ici, deux admins activent chacun un template
    DIFFÉRENT du MÊME `country_pack` en même temps : prouve que
    `_upsert_active_pointer` (apps/pricing/services.py) rattrape bien
    l'`IntegrityError` de la contrainte `UNIQUE` du `OneToOneField`
    (`ActiveLegalPaymentTierTemplate.country_pack`) côté DEUXIÈME
    transaction, plutôt que de la laisser remonter, et qu'un SEUL pointeur
    survit — jamais deux.
    """

    def test_two_concurrent_activations_for_the_same_country_pack_never_duplicate_the_pointer(self):
        # Setup entier dans un `transaction.atomic()` EXPLICITE — sous
        # `django_db(transaction=True)`, aucune transaction implicite
        # n'enveloppe le test (contrairement à `@pytest.mark.django_db`
        # simple) : `_register_admin` appelle `set_rls_context` (`SET
        # LOCAL`), qui n'a d'effet réel qu'à l'intérieur d'un bloc
        # transactionnel explicite (voir `apps/core/rls.py`). Même piège
        # déjà résolu par `_build_open_reserve_with_real_commits`
        # (`apps/tasks/test_celery_integration.py`, ticket 017). Le bloc se
        # commite normalement à sa sortie, rendant les données visibles
        # aux DEUX connexions séparées des threads ci-dessous.
        with transaction.atomic():
            _admin_client, _org, admin_user = _register_admin(
                'tier-race-admin@example.com', 'Org Tier Race Admin',
            )
            senegal = CountryPack.objects.get(code='SN')
            template_a = services.create_legal_payment_tier_template(
                admin=admin_user, country_pack_id=senegal.id, version=1, steps=SENEGAL_TIER_STEPS,
            )
            template_b = services.create_legal_payment_tier_template(
                admin=admin_user, country_pack_id=senegal.id, version=2, steps=SENEGAL_TIER_STEPS,
            )

        # Barrière posée sur les deux TOUT PREMIERS
        # `ActiveLegalPaymentTierTemplate.objects.get(...)` observés (le
        # "aucun pointeur n'existe encore" initial de chaque thread, avant
        # toute écriture) — garantit le chevauchement visé. Le `get()`
        # ultérieur (relecture après `IntegrityError` rattrapée, côté
        # thread perdant) ne doit JAMAIS réattendre : une seconde attente
        # interbloquerait pour toujours (un seul des deux threads
        # l'emprunte).
        barrier = threading.Barrier(2, timeout=5)
        call_counter = count()
        counter_lock = threading.Lock()
        original_get = ActiveLegalPaymentTierTemplate.objects.get

        def get_with_barrier(*args, **kwargs):
            with counter_lock:
                call_index = next(call_counter)
            if call_index < 2:
                barrier.wait(timeout=5)
            return original_get(*args, **kwargs)

        results = []
        errors = []
        results_lock = threading.Lock()

        def worker(template):
            try:
                activated = services.activate_legal_payment_tier_template(
                    admin=admin_user, template_id=template.id,
                )
                with results_lock:
                    results.append(activated)
            except Exception as exc:  # noqa: BLE001 — un échec ici est le bug à révéler, jamais à masquer
                with results_lock:
                    errors.append(exc)
            finally:
                connection.close()

        with mock.patch.object(ActiveLegalPaymentTierTemplate.objects, 'get', side_effect=get_with_barrier):
            thread_a = threading.Thread(target=worker, args=(template_a,))
            thread_b = threading.Thread(target=worker, args=(template_b,))
            thread_a.start()
            thread_b.start()
            thread_a.join(timeout=10)
            thread_b.join(timeout=10)

        assert errors == [], (
            f'Une transaction concurrente a laissé remonter une exception non rattrapée : {errors!r}'
        )
        assert len(results) == 2

        pointers = list(ActiveLegalPaymentTierTemplate.objects.filter(country_pack=senegal))
        assert len(pointers) == 1
        assert pointers[0].template_id in {template_a.id, template_b.id}
