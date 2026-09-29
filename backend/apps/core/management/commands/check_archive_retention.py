"""Lot 5 (A6, PO-2026-09-29-04) — conservation des archives : jusqu'à 90
jours après la fin de la campagne investisseurs (`DEMO_CAMPAIGN_END`).

Liste les archives échues et, avec `--record`, inscrit le constat au journal
(organisation de l'administrateur de démonstration). Ne supprime rien : la
suppression est une opération d'exploitation privilégiée, avec sauvegarde,
suivant `docs/exploitation/PROCEDURE_REINITIALISATION_DEMO.md`.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.instances import campaign_end, check_retention, instance_rows


class Command(BaseCommand):
    help = 'Liste les archives de démonstration dont la conservation est échue (A6).'

    def add_arguments(self, parser):
        parser.add_argument('--record', action='store_true', help='Inscrit les archives échues au journal.')

    def handle(self, *args, **options):
        end = campaign_end()
        if end is None:
            self.stdout.write('Fin de campagne non fixée (DEMO_CAMPAIGN_END) : aucune archive échue.')
            return
        archived = [row for row in instance_rows() if row['status'] == 'ARCHIVED']
        if options['record']:
            from apps.organizations.models import Organization
            from apps.sales.management.commands.seed_demo_scenario import KEYIMMO_ORG

            organization = Organization.objects.filter(name=KEYIMMO_ORG).first()
            with transaction.atomic():
                expired = check_retention(organization_id=organization.id if organization else None)
        else:
            expired = check_retention()
        self.stdout.write(f'Fin de campagne : {end.isoformat()} ; conservation 90 jours.')
        for row in archived:
            state = 'ÉCHUE' if row['retention_expired'] else 'conservée'
            self.stdout.write(f"  {row['code']} — archivée le {row['archived_at'][:10]} — jusqu'au {row['retention_until']} : {state}")
        self.stdout.write(f'{len(expired)} archive(s) échue(s).')
