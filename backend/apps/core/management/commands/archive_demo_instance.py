"""Archive l'instance de démonstration active puis, avec `--reseed`, crée
une instance NOUVELLE à partir du jeu initial versionné : nouveaux objets,
aucun lien avec l'ancienne instance.

Lot 5 (PO-2026-09-29-03) : même service que l'action « Archiver et créer
une nouvelle instance » de l'écran Administration ; l'archive reste en base,
consultable en lecture seule par l'administrateur et le gestionnaire, et
refuse toute écriture. Les comptes de démonstration ne sont pas modifiés.
"""
from django.core.management.base import BaseCommand, CommandError
from rest_framework.exceptions import ValidationError

from apps.core.instances import archive_active_instance


class Command(BaseCommand):
    help = "Archive l'instance de démonstration active (et en crée une nouvelle avec --reseed)."

    def add_arguments(self, parser):
        parser.add_argument('--confirm', action='store_true', help='Confirme l’archivage.')
        parser.add_argument('--reseed', action='store_true', help='Crée ensuite une nouvelle instance.')

    def handle(self, *args, **options):
        if not options['confirm']:
            raise CommandError('Refus : ajoutez --confirm.')
        try:
            archived, created = archive_active_instance(
                actor=None, caller_organization_id=None, renew=options['reseed'],
            )
        except ValidationError as exc:
            raise CommandError(str(exc.detail)) from exc
        self.stdout.write(f'Instance {archived.code} archivée.')
        if created is not None:
            self.stdout.write(f'Nouvelle instance {created.code} ({created.dataset_version}).')
