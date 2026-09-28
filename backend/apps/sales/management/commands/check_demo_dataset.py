"""PO-2026-09-28-19 (T14) — vérification EN LECTURE SEULE de la base face au
jeu initial versionné (`seed_demo_scenario`, DEMO-CI-v1, CDC §9.1).

À lancer juste après une réinitialisation (`scripts/reset_demo_local.sh`,
étape 5/5) : chaque contrôle affiche « OK » ou « ÉCART », et la commande
sort en erreur (code 1) s'il reste un écart. Elle n'écrit rien : chaque
lecture a lieu dans une transaction annulée à la fin, sous le contexte RLS
de l'organisation (ou de l'utilisateur) concernée.

Lancée AVANT une réinitialisation, elle décrit simplement l'écart entre la
base courante et le jeu initial (parcours déjà joué, données de travail).
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.demo import active_demo_instance
from apps.core.rls import set_rls_context
from apps.evidence.models import Evidence, WorkDeclaration
from apps.inspections.models import Inspection, InspectionMission, Reserve
from apps.organizations.models import CountryPack, Membership, Organization
from apps.pricing.services import get_active_legal_payment_tier_template
from apps.programs.models import Lot, Program
from apps.sales.models import CustomerReceipt, Disbursement, PaymentCall, PaymentNotice, Reservation

from .seed_demo_scenario import (
    ACCOUNTS, CONTROL_ORG, COUNTRY_CODE, DATASET_VERSION, KEYIMMO_ORG, LOTS, MILESTONE_STEPS, PRICE, PROGRAM_NAME,
    PROMOTER_ORG,
)


class _Rollback(Exception):
    pass


class Command(BaseCommand):
    help = 'Vérifie, sans rien écrire, que la base correspond au jeu initial DEMO-CI-v1 (T14).'

    def handle(self, *args, **options):
        self.gaps = 0
        try:
            with transaction.atomic():
                self._check()
                raise _Rollback
        except _Rollback:
            pass
        if self.gaps:
            raise CommandError(f'{self.gaps} écart(s) avec le jeu initial {DATASET_VERSION}.')
        self.stdout.write(self.style.SUCCESS(f'Base conforme au jeu initial {DATASET_VERSION}.'))

    def _report(self, ok, label, detail=''):
        if not ok:
            self.gaps += 1
        suffix = f' — {detail}' if detail else ''
        self.stdout.write(f"{'OK     ' if ok else 'ÉCART  '} {label}{suffix}")

    def _check(self):
        instance = active_demo_instance()
        self._report(
            instance is not None and instance.dataset_version == DATASET_VERSION,
            'Instance de démonstration active',
            f'{instance.code} ({instance.dataset_version})' if instance else 'aucune',
        )

        country_pack = CountryPack.objects.filter(code=COUNTRY_CODE).first()
        self._report(country_pack is not None, f'Country Pack {COUNTRY_CODE}')

        organizations = {name: Organization.objects.filter(name=name).first() for name in (KEYIMMO_ORG, PROMOTER_ORG, CONTROL_ORG)}
        for name, organization in organizations.items():
            self._report(organization is not None, f'Organisation « {name} »')

        User = get_user_model()
        for email, _full_name, role_code, organization_name in ACCOUNTS:
            user = User.objects.filter(email=email).first()
            if user is None:
                self._report(False, f'Compte {email}', 'absent')
                continue
            set_rls_context(user_id=user.id)
            memberships = list(Membership.objects.filter(user=user).select_related('organization', 'role'))
            expected_org = organization_name or f'Compte personnel — {email}'
            ok = any(m.role.code == role_code and m.organization.name == expected_org for m in memberships)
            self._report(ok and user.is_active, f'Compte {email}', f'{role_code} · {expected_org}')

        promoter = organizations[PROMOTER_ORG]
        if promoter is None or instance is None:
            return
        set_rls_context(organization_id=promoter.id)
        programs = list(Program.objects.filter(demo_instance=instance))
        self._report(
            [program.name for program in programs] == [PROGRAM_NAME],
            'Un seul programme dans l’instance active', ', '.join(program.name for program in programs) or 'aucun',
        )
        lots = list(Lot.objects.filter(asset__program__demo_instance=instance).order_by('name'))
        expected_lots = [(name, surface) for name, surface in LOTS]
        self._report(
            [(lot.name, lot.surface) for lot in lots] == expected_lots
            and all(lot.sale_price == PRICE and lot.commercial_status == 'disponible' for lot in lots),
            'Lots A1 et A2, disponibles, 30 000 000 XOF',
            ', '.join(f'{lot.name} ({lot.commercial_status}, {lot.sale_price})' for lot in lots),
        )
        expected_steps = [label for _code, label in MILESTONE_STEPS]
        for lot in lots:
            labels = list(lot.milestones.order_by('order').values_list('label', flat=True))
            self._report(labels == expected_steps, f'Jalons du {lot.name}', ' → '.join(labels))

        # CDC §9.1 : « les décisions et contrôles résultent des actions réelles
        # des comptes et ne sont pas préremplis comme réussis ».
        lot_ids = [lot.id for lot in lots]
        activity = {
            'déclarations': WorkDeclaration.objects.filter(milestone__lot_id__in=lot_ids).count(),
            'pièces': Evidence.objects.filter(work_declaration__milestone__lot_id__in=lot_ids).count(),
            'missions': InspectionMission.objects.filter(work_declaration__milestone__lot_id__in=lot_ids).count(),
            'avis': Inspection.objects.filter(lot_id__in=lot_ids).count(),
            'réserves': Reserve.objects.filter(lot_id__in=lot_ids).count(),
            'réservations': Reservation.objects.filter(lot_id__in=lot_ids).count(),
            'appels de fonds': PaymentCall.objects.filter(reservation__lot_id__in=lot_ids).count(),
            'encaissements': CustomerReceipt.objects.filter(reservation__lot_id__in=lot_ids).count(),
            'signalements clients': PaymentNotice.objects.filter(reservation__lot_id__in=lot_ids).count(),
            'décaissements': Disbursement.objects.filter(program__demo_instance=instance).count(),
        }
        busy = {name: count for name, count in activity.items() if count}
        self._report(
            not busy, 'Aucune action préremplie (parcours à jouer)',
            ', '.join(f'{count} {name}' for name, count in busy.items()) or 'aucune',
        )

        template = get_active_legal_payment_tier_template(country_pack.id) if country_pack else None
        if template is None:
            self._report(False, f'Barème de paliers {COUNTRY_CODE} actif', 'aucun')
            return
        steps = list(template.steps.order_by('order'))
        flags_ok = bool(steps) and not steps[0].requires_technical_acceptance and all(
            step.requires_technical_acceptance for step in steps[1:]
        )
        self._report(
            not template.legally_validated and flags_ok and steps[0].cumulative_cap_percent == Decimal('10'),
            f'Barème de paliers {COUNTRY_CODE} v{template.version}',
            'non validé juridiquement ; premier versement 10 % sans condition ; paliers suivants après acceptation technique'
            if flags_ok else 'conditions des paliers incorrectes',
        )
