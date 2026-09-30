"""PO-2026-09-29-10 (T16) — vérifie, en lecture seule et depuis le compte
applicatif, que le journal est hors de sa portée. Échoue s'il reste un
écart ; la protection se pose avec `scripts/sql/protect_journal.sql`."""
from django.core.management.base import BaseCommand, CommandError

from apps.audit.journal_protection import OWNER_ROLE, collect_facts, evaluate


class Command(BaseCommand):
    help = 'Vérifie que le compte applicatif ne peut ni modifier ni supprimer le journal (T16).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--proprietaire', default=OWNER_ROLE,
            help=f'Rôle censé posséder le journal (défaut : {OWNER_ROLE}, ADR 0005).',
        )

    def handle(self, *args, **options):
        checks = evaluate(collect_facts(owner_role=options['proprietaire']))
        for ok, label in checks:
            self.stdout.write(f'{"OK     " if ok else "MANQUE "} {label}')
        missing = [label for ok, label in checks if not ok]
        if missing:
            raise CommandError(
                f'Journal non protégé ({len(missing)} écart(s)) : exécuter scripts/sql/protect_journal.sql '
                'en administrateur Postgres (docs/adr/0005).',
            )
        self.stdout.write(self.style.SUCCESS('Journal hors de portée du compte applicatif.'))
