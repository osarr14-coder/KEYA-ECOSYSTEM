"""Audit UI R1 (D01, T14 partiel) — archive l'instance de démonstration
active puis, avec `--reseed`, crée une instance NOUVELLE à partir du jeu
initial versionné (`seed_demo_scenario`) : nouveaux objets, aucun lien avec
l'ancienne instance, dont les programmes ne sont plus listés.

Aucune donnée n'est supprimée : l'instance archivée reste en base.
Limite connue : l'interdiction d'écrire dans une instance archivée et sa
consultation dans l'application ne sont pas encore implémentées (T14).
"""
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.core.demo import active_demo_instance
from apps.core.models import DemoInstanceStatus


class Command(BaseCommand):
    help = "Archive l'instance de démonstration active (et en crée une nouvelle avec --reseed)."

    def add_arguments(self, parser):
        parser.add_argument('--confirm', action='store_true', help='Confirme l’archivage.')
        parser.add_argument('--reseed', action='store_true', help='Crée ensuite une nouvelle instance (DEMO_PASSWORD).')

    def handle(self, *args, **options):
        if not options['confirm']:
            raise CommandError('Refus : ajoutez --confirm.')
        with transaction.atomic():
            instance = active_demo_instance()
            if instance is None:
                raise CommandError('Aucune instance de démonstration active.')
            instance.status = DemoInstanceStatus.ARCHIVED
            instance.archived_at = timezone.now()
            instance.save(update_fields=['status', 'archived_at'])
        self.stdout.write(f'Instance {instance.code} archivée.')
        if options['reseed']:
            call_command('seed_demo_scenario', stdout=self.stdout)
            successor = active_demo_instance()
            if successor is not None and successor.origin_id is None:
                successor.origin = instance
                successor.save(update_fields=['origin'])
