"""Ticket B-050 — barème de paiement de DÉMONSTRATION pour le Country Pack
Sénégal (le seul existant, porté par toutes les organisations). Aucun barème
n'avait jamais été seedé (audit CDC V3). Valeurs NON VALIDÉES JURIDIQUEMENT
(CDC V3 §3 : « valeurs fictives de démonstration, sans couverture juridique
revendiquée ») : premier versement 10 % (CDC §9.1), puis un palier par jalon
de construction de même code (voir apps.sales.services.
compute_payment_call_candidates).

Idempotente : ne fait rien si un barème est déjà actif pour ce pack —
jamais une seconde activation silencieuse qui remplacerait un barème posé
à la main par l'admin (onglet « Paliers légaux », apps/web).
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.organizations.models import CountryPack
from apps.pricing.models import LegalPaymentTierTemplate
from apps.pricing.services import (
    activate_legal_payment_tier_template,
    create_legal_payment_tier_template,
    get_active_legal_payment_tier_template,
)

# Ticket B-050 — barème de démonstration du Country Pack Sénégal.
DEMO_STEPS = [
    {'order': 1, 'code': 'reservation', 'label': 'Premier versement (réservation)', 'cumulative_cap_percent': Decimal('10'), 'allows_progressive_payments': False},
    {'order': 2, 'code': 'fondations', 'label': 'Fondations achevées', 'cumulative_cap_percent': Decimal('35'), 'allows_progressive_payments': False},
    {'order': 3, 'code': 'gros_oeuvre', 'label': 'Gros œuvre (hors d\'eau)', 'cumulative_cap_percent': Decimal('70'), 'allows_progressive_payments': False},
    {'order': 4, 'code': 'reception', 'label': 'Achèvement (réception)', 'cumulative_cap_percent': Decimal('95'), 'allows_progressive_payments': False},
    {'order': 5, 'code': 'livraison', 'label': 'Livraison', 'cumulative_cap_percent': Decimal('100'), 'allows_progressive_payments': False},
]


# Audit UI R1 (étape 0) — barème de démonstration du Country Pack Côte
# d'Ivoire (CDC R1 A02), aligné sur le jeu §9.1 : premier versement 10 %
# (3 000 000 XOF sur 30 000 000, frais inclus), puis un palier par jalon du
# template CI (Fondations, Élévation). Pourcentages suivants FICTIFS, non
# validés juridiquement ni par le PO (A09) — données de présentation.
CI_DEMO_STEPS = [
    {'order': 1, 'code': 'reservation', 'label': 'Premier versement (réservation)', 'cumulative_cap_percent': Decimal('10'), 'allows_progressive_payments': False},
    {'order': 2, 'code': 'fondations', 'label': 'Fondations', 'cumulative_cap_percent': Decimal('50'), 'allows_progressive_payments': False},
    {'order': 3, 'code': 'elevation', 'label': 'Élévation', 'cumulative_cap_percent': Decimal('100'), 'allows_progressive_payments': False},
]

STEPS_BY_COUNTRY = {'SN': DEMO_STEPS, 'CI': CI_DEMO_STEPS}


class Command(BaseCommand):
    help = 'Crée et active un barème de paiement de démonstration (non validé juridiquement) pour un Country Pack.'

    def add_arguments(self, parser):
        parser.add_argument('--admin-email', required=True, help='Compte admin_keyimmo auteur du barème.')
        parser.add_argument(
            '--country', default='SN', choices=sorted(STEPS_BY_COUNTRY), help='Code du Country Pack (défaut : SN).',
        )

    def handle(self, *args, **options):
        code = options.get('country') or 'SN'
        country_pack = CountryPack.objects.filter(code=code).first()
        if country_pack is None:
            raise CommandError(f"CountryPack '{code}' introuvable — lancer `manage.py migrate` d'abord.")
        if get_active_legal_payment_tier_template(country_pack.id) is not None:
            self.stdout.write(self.style.WARNING(f'Un barème est déjà actif pour {code} : rien à faire.'))
            return
        admin = get_user_model().objects.filter(email=options['admin_email']).first()
        if admin is None:
            raise CommandError(f"Utilisateur {options['admin_email']} introuvable.")
        with transaction.atomic():
            version = (
                LegalPaymentTierTemplate.objects.filter(country_pack=country_pack).order_by('-version')
                .values_list('version', flat=True).first() or 0
            ) + 1
            template = create_legal_payment_tier_template(
                admin=admin, country_pack_id=country_pack.id, version=version, steps=STEPS_BY_COUNTRY[code],
            )
            activate_legal_payment_tier_template(admin=admin, template_id=template.id)
        self.stdout.write(self.style.SUCCESS(
            f'Barème de démonstration v{version} créé et activé pour {code} (valeurs NON validées juridiquement).'
        ))
