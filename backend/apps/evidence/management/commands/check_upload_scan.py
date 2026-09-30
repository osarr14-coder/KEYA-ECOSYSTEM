"""PO-2026-09-29-13 (T15) — vérifie que l'analyse des dépôts fonctionne :
moteur antivirus joignable, fichier sain accepté, fichier de test EICAR
détecté. Échoue sinon (les dépôts seraient alors tous refusés)."""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils.module_loading import import_string

from apps.evidence.scanning import ScanUnavailable
from apps.evidence.testing import EICAR


class Command(BaseCommand):
    help = 'Vérifie le moteur d’analyse des dépôts (T15) : joignable, sain accepté, EICAR détecté.'

    def handle(self, *args, **options):
        scan = import_string(settings.KEYA_UPLOAD_ANTIVIRUS)
        try:
            clean = scan(b'%PDF-1.4\n%keya check_upload_scan\n%%EOF\n')
            infected = scan(EICAR)
        except ScanUnavailable:
            raise CommandError(
                'Moteur antivirus injoignable ou non configuré (KEYA_CLAMD_ADDRESS) : tout dépôt est refusé.',
            )
        self.stdout.write(f'{"OK     " if clean is None else "MANQUE "} fichier sain accepté')
        self.stdout.write(f'{"OK     " if infected else "MANQUE "} fichier de test EICAR détecté ({infected or "non"})')
        if clean is not None or not infected:
            raise CommandError('Analyse des dépôts défaillante.')
        self.stdout.write(self.style.SUCCESS('Analyse des dépôts opérationnelle.'))
