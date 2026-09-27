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

DEMO_STEPS = [
    {'order': 1, 'code': 'reservation', 'label': 'Premier versement (réservation)', 'cumulative_cap_percent': Decimal('10'), 'allows_progressive_payments': False},
    {'order': 2, 'code': 'fondations', 'label': 'Fondations achevées', 'cumulative_cap_percent': Decimal('35'), 'allows_progressive_payments': False},
    {'order': 3, 'code': 'gros_oeuvre', 'label': 'Gros œuvre (hors d\'eau)', 'cumulative_cap_percent': Decimal('70'), 'allows_progressive_payments': False},
    {'order': 4, 'code': 'reception', 'label': 'Achèvement (réception)', 'cumulative_cap_percent': Decimal('95'), 'allows_progressive_payments': False},
    {'order': 5, 'code': 'livraison', 'label': 'Livraison', 'cumulative_cap_percent': Decimal('100'), 'allows_progressive_payments': False},
]


class Command(BaseCommand):
    help = 'Crée et active un barème de paiement de démonstration (non validé juridiquement) pour le Sénégal.'

    def add_arguments(self, parser):
        parser.add_argument('--admin-email', required=True, help='Compte admin_keyimmo auteur du barème.')

    def handle(self, *args, **options):
        country_pack = CountryPack.objects.filter(code='SN').first()
        if country_pack is None:
            raise CommandError("CountryPack 'SN' introuvable — lancer `manage.py migrate` d'abord.")
        if get_active_legal_payment_tier_template(country_pack.id) is not None:
            self.stdout.write(self.style.WARNING('Un barème est déjà actif pour SN : rien à faire.'))
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
                admin=admin, country_pack_id=country_pack.id, version=version, steps=DEMO_STEPS,
            )
            activate_legal_payment_tier_template(admin=admin, template_id=template.id)
        self.stdout.write(self.style.SUCCESS(
            f'Barème de démonstration v{version} créé et activé pour SN (valeurs NON validées juridiquement).'
        ))
