"""Audit UI R1 (étape 0) — le jeu initial versionné `DEMO-CI-v1` est conforme
au CDC R1 §9.1 et à l'arbitrage A02 (Côte d'Ivoire)."""
from decimal import Decimal

import pytest
from django.core.management import call_command

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import Membership, Organization
from apps.pricing.services import get_active_legal_payment_tier_template
from apps.programs.models import Lot, Milestone, Program

from .management.commands.seed_demo_scenario import DATASET_VERSION, PROGRAM_NAME, PROMOTER_ORG

PASSWORD = 'Demo-Test-2026!'


def _seed():
    call_command('seed_demo_scenario', password=PASSWORD)


@pytest.mark.django_db
class TestDemoDataset:
    def test_dataset_is_versioned_and_located_in_cote_divoire(self):
        assert DATASET_VERSION == 'DEMO-CI-v2'  # PO-2026-09-28-63 : pièces exigées
        _seed()
        promoter = Organization.objects.get(name=PROMOTER_ORG)
        assert promoter.country_pack.code == 'CI'

    def test_one_program_two_properties_at_30_million_with_the_two_milestones_of_the_scenario(self):
        _seed()
        promoter = Organization.objects.get(name=PROMOTER_ORG)
        set_rls_context(organization_id=promoter.id)
        programs = Program.objects.filter(organization=promoter)
        assert [program.name for program in programs] == [PROGRAM_NAME]
        lots = list(Lot.objects.filter(organization=promoter).order_by('name'))
        assert len(lots) == 2
        assert all(lot.sale_price == Decimal('30000000.00') for lot in lots)
        for lot in lots:
            labels = list(Milestone.objects.filter(lot=lot).order_by('order').values_list('label', flat=True))
            assert labels == ['Fondations', 'Élévation']

    def test_the_accounts_of_section_9_1_one_per_role(self):
        _seed()
        roles = {}
        for user in User.objects.filter(email__endswith='.demo@keya.test'):
            set_rls_context(user_id=user.id)
            roles[user.email] = sorted(Membership.objects.filter(user=user).values_list('role__code', flat=True))
        assert roles == {
            'admin.demo@keya.test': ['admin_keyimmo'],
            'adv.demo@keya.test': ['gestionnaire_adv'],
            'finance.demo@keya.test': ['finance'],
            'constructeur.demo@keya.test': ['constructeur'],
            'inspecteur.demo@keya.test': ['inspecteur'],
            'client1.demo@keya.test': ['client'],
            'client2.demo@keya.test': ['client'],
        }

    def test_first_payment_is_10_percent_fees_included_3_million_on_30(self):
        _seed()
        promoter = Organization.objects.get(name=PROMOTER_ORG)
        template = get_active_legal_payment_tier_template(promoter.country_pack_id)
        steps = list(template.steps.order_by('order'))
        assert steps[0].cumulative_cap_percent == Decimal('10')
        assert Decimal('30000000') * steps[0].cumulative_cap_percent / 100 == Decimal('3000000')
        # Chaque palier suivant correspond à un jalon du scénario.
        assert [step.code for step in steps[1:]] == ['fondations', 'elevation']

    def test_rerunning_the_seed_never_resets_a_demonstration_in_progress(self):
        _seed()
        _seed()
        promoter = Organization.objects.get(name=PROMOTER_ORG)
        set_rls_context(organization_id=promoter.id)
        assert Program.objects.filter(organization=promoter).count() == 1
        assert Lot.objects.filter(organization=promoter).count() == 2
