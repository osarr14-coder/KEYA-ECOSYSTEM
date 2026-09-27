from django.core.management.base import BaseCommand

from apps.sales.services import expire_overdue_reservations


class Command(BaseCommand):
    help = (
        "Expire les blocages de réservation échus (ticket B-048). L'expiration "
        "est aussi appliquée à chaque accès : cette commande n'est qu'un balayage "
        "planifiable, jamais une condition pour qu'un lot soit libéré."
    )

    def handle(self, *args, **options):
        expired = expire_overdue_reservations()
        self.stdout.write(self.style.SUCCESS(f'{expired} réservation(s) expirée(s).'))
