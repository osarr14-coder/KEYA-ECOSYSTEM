"""Ticket B-053 — scénario de démonstration du CDC V3 §9.1, pour qu'un
non-technicien puisse se connecter et dérouler le parcours (T19).

**Opt-in** : ne fait RIEN sans mot de passe (`--password` ou variable
d'environnement `DEMO_PASSWORD`) — un déploiement ne reçoit jamais de comptes
de démonstration sans décision explicite de son propriétaire, qui choisit
lui-même le mot de passe (jamais un secret écrit dans le dépôt).

Idempotente : relançable à chaque déploiement. Elle (re)pose les comptes,
leurs rôles et leur mot de passe, mais ne touche JAMAIS à un programme déjà
créé — une démonstration en cours n'est pas réinitialisée par un redéploiement.

Données intégralement fictives (CDC §9.1) ; aucun acteur ne correspond à un
partenaire contractuellement acquis.

Audit UI R1 (étape 0) — **jeu initial versionné `DEMO-CI-v1`**, conforme au
CDC R1 §9.1 et à l'arbitrage A02 (Côte d'Ivoire) : Country Pack « CI », un
programme « Résidence Démonstration Abidjan », deux biens à 30 000 000 XOF,
deux jalons (« Fondations », « Élévation », template CI posé par cette
commande), deux clients, un constructeur, un bureau de contrôle, les
comptes gestionnaire, Finance et administrateur. Toute évolution du jeu
change `DATASET_VERSION` (jamais une modification silencieuse).
"""
import uuid
from decimal import Decimal

from decouple import config
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.core.demo import active_demo_instance
from apps.core.models import DemoInstance
from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Membership, Organization, Role
from apps.programs.models import (
    Asset, Lot, LotCommercialStatus, MilestoneTemplate, MilestoneTemplateStep, Program,
)
from apps.programs.services import instantiate_milestones_for_lot

DATASET_VERSION = 'DEMO-CI-v1'
COUNTRY_CODE = 'CI'
COUNTRY_LABEL = "Côte d'Ivoire"
# CDC R1 §9.1 : deux jalons de démonstration. Valeurs fictives, non validées
# juridiquement (A09). Posés par le jeu de démonstration, pas par une
# migration : une base sans démonstration (tests, autre déploiement) ne
# reçoit aucun Country Pack ni template fictif.
MILESTONE_TEMPLATE_VERSION = 1
MILESTONE_STEPS = [('fondations', 'Fondations'), ('elevation', 'Élévation')]

KEYIMMO_ORG = 'KEYIMMO AFRIC (démo)'
# PO-2026-09-27-13 : le terme « promoteur » disparaît de la plateforme ;
# KEYIMMO AFRIC lance le programme, le partenaire affecté est un constructeur.
PROMOTER_ORG = 'Constructeur Démonstration Abidjan'
LEGACY_PROMOTER_ORG_NAMES = ('Promoteur-constructeur Démonstration Abidjan',)
CONTROL_ORG = 'Bureau de contrôle Démonstration'
PROGRAM_NAME = 'Résidence Démonstration Abidjan'

# (email, nom affiché, rôle, organisation — None = compte personnel du client)
ACCOUNTS = [
    ('admin.demo@keya.test', 'Admin KEYIMMO (démo)', 'admin_keyimmo', KEYIMMO_ORG),
    ('adv.demo@keya.test', 'Gestionnaire ADV (démo)', 'gestionnaire_adv', KEYIMMO_ORG),
    ('finance.demo@keya.test', 'Finance (démo)', 'finance', KEYIMMO_ORG),
    ('constructeur.demo@keya.test', 'Constructeur (démo)', 'constructeur', PROMOTER_ORG),
    ('inspecteur.demo@keya.test', 'Bureau de contrôle (démo)', 'inspecteur', CONTROL_ORG),
    ('client1.demo@keya.test', 'Awa Koné (cliente fictive)', 'client', None),
    ('client2.demo@keya.test', 'Yao Kouassi (client fictif)', 'client', None),
]

# CDC §9.1 : prix fictif 30 000 000 XOF.
LOTS = [('Lot A1', Decimal('82.00')), ('Lot A2', Decimal('75.00'))]
PRICE = Decimal('30000000.00')


class Command(BaseCommand):
    help = 'Scénario de démonstration CDC V3 (comptes par rôle, programme, lots, barème). Opt-in : DEMO_PASSWORD.'

    def add_arguments(self, parser):
        parser.add_argument('--password', help='Mot de passe commun des comptes (sinon DEMO_PASSWORD).')

    def handle(self, *args, **options):
        password = options.get('password') or config('DEMO_PASSWORD', default='')
        if not password:
            self.stdout.write('DEMO_PASSWORD absent : aucun compte de démonstration créé (opt-in).')
            return
        if len(password) < 10:
            raise CommandError('DEMO_PASSWORD doit faire au moins 10 caractères.')

        country_pack = self._ensure_country_pack()
        self.stdout.write(f'Jeu initial {DATASET_VERSION} (Country Pack {COUNTRY_CODE}).')

        with transaction.atomic():
            # Base créée avant PO-2026-09-27-13 : l'organisation est renommée,
            # jamais dupliquée.
            if not Organization.objects.filter(name=PROMOTER_ORG).exists():
                Organization.objects.filter(name__in=LEGACY_PROMOTER_ORG_NAMES).update(name=PROMOTER_ORG)
            organizations = {
                name: Organization.objects.get_or_create(name=name, defaults={'country_pack': country_pack})[0]
                for name in (KEYIMMO_ORG, PROMOTER_ORG, CONTROL_ORG)
            }
            User = get_user_model()
            for email, full_name, role_code, organization_name in ACCOUNTS:
                user, _ = User.objects.get_or_create(email=email, defaults={'full_name': full_name})
                user.full_name = full_name
                user.set_password(password)
                user.save(update_fields=['full_name', 'password'])
                organization = organizations.get(organization_name) or Organization.objects.get_or_create(
                    name=f'Compte personnel — {email}', defaults={'country_pack': country_pack},
                )[0]
                role, _ = Role.objects.get_or_create(code=role_code, defaults={'label': role_code})
                # organizations_membership est en RLS : SELECT via user_id,
                # INSERT/UPDATE via l'organisation (voir seed_admin).
                set_rls_context(user_id=user.id, organization_id=organization.id)
                membership, created = Membership.objects.get_or_create(
                    user=user, organization=organization, defaults={'role': role},
                )
                if not created and membership.role_id != role.id:
                    membership.role = role
                    membership.save(update_fields=['role'])
                self.stdout.write(f'  {email} — {role_code}')

            instance = self._ensure_demo_instance()
            promoter = organizations[PROMOTER_ORG]
            set_rls_context(organization_id=promoter.id)
            if Program.objects.filter(organization=promoter, name=PROGRAM_NAME, demo_instance=instance).exists():
                self.stdout.write(
                    f'Programme « {PROGRAM_NAME} » déjà présent dans {instance.code} : laissé tel quel.',
                )
            else:
                program = Program.objects.create(organization=promoter, name=PROGRAM_NAME, demo_instance=instance)
                asset = Asset.objects.create(
                    organization=promoter, program=program, name='Bâtiment A', location='Cocody, Abidjan',
                )
                for name, surface in LOTS:
                    # Promoteur-constructeur en auto-exécution : bénéficiaire
                    # explicite des décaissements (ticket B-052).
                    lot = Lot.objects.create(
                        organization=promoter, asset=asset, name=name, surface=surface,
                        sale_price=PRICE, commercial_status=LotCommercialStatus.DISPONIBLE,
                        assigned_organization=promoter,
                    )
                    instantiate_milestones_for_lot(lot)
                self.stdout.write(f'Programme « {PROGRAM_NAME} » créé : {len(LOTS)} lots à {PRICE} XOF.')

        call_command(
            'seed_demo_payment_tiers', admin_email='admin.demo@keya.test', country=COUNTRY_CODE, stdout=self.stdout,
        )
        self.stdout.write(self.style.SUCCESS(
            f'Scénario de démonstration {DATASET_VERSION} prêt : {len(ACCOUNTS)} comptes (mot de passe : DEMO_PASSWORD).'
        ))

    def _ensure_demo_instance(self):
        """Audit UI R1 (D01) : instance ACTIVE de la démonstration, créée
        si aucune n'existe. Une instance existante est réutilisée telle
        quelle — une nouvelle instance ne naît que d'une réinitialisation
        (archivage de la précédente)."""
        instance = active_demo_instance()
        if instance is None:
            code = f'DEMO-{COUNTRY_CODE}-{timezone.now():%Y%m%d}-{uuid.uuid4().hex[:4].upper()}'
            instance = DemoInstance.objects.create(code=code, dataset_version=DATASET_VERSION)
            self.stdout.write(f'Instance de démonstration {instance.code} créée ({DATASET_VERSION}).')
        else:
            self.stdout.write(f'Instance de démonstration active : {instance.code}.')
        return instance

    @staticmethod
    @transaction.atomic
    def _ensure_country_pack():
        """Country Pack CI et son template de jalons, créés s'ils manquent.

        Un template CI v1 déjà présent n'est jamais modifié (version
        conservée, CDC §1) : toute évolution passe par une nouvelle version.
        """
        country_pack, _ = CountryPack.objects.get_or_create(
            code=COUNTRY_CODE, defaults={'label': COUNTRY_LABEL},
        )
        template, created = MilestoneTemplate.objects.get_or_create(
            country_pack=country_pack, version=MILESTONE_TEMPLATE_VERSION, defaults={'is_active': True},
        )
        if created:
            MilestoneTemplateStep.objects.bulk_create([
                MilestoneTemplateStep(template=template, order=index, code=code, label=label)
                for index, (code, label) in enumerate(MILESTONE_STEPS, start=1)
            ])
        return country_pack
