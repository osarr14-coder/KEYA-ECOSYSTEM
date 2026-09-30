"""PO-2026-09-30-07 (dérogation T15) — repasse au moteur antivirus les
documents « non analysés » : acceptés sans antivirus sous la dérogation de
la DÉMO, ou déposés avant l'analyse des dépôts (PO-2026-09-29-13).

À lancer dès que le moteur est branché (`KEYA_CLAMD_ADDRESS`). Pour chaque
document : analyse du contenu PDF puis antivirus, sur le fichier tel qu'il
est stocké (les images ont été ré-encodées au dépôt). Sain : statut
« analysé ». Détecté : statut « détecté », le fichier n'est plus servi
(téléchargement refusé) mais reste en base pour l'enquête. Chaque résultat
est inscrit au journal d'audit de l'organisation du document.

Refuse de tourner sans moteur (dérogation encore active, ou moteur
injoignable) : rien n'est alors modifié.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.audit import services as audit_services
from apps.core.rls import set_rls_context
from apps.evidence.models import AntivirusStatus, Document
from apps.evidence.scanning import (
    QUARANTINED, RESCANNED_CLEAN, ScanRejected, ScanUnavailable, antivirus_waived, scan_data,
)
from apps.evidence.validators import EXTENSION_BY_KIND
from apps.organizations.models import Organization


def _kind(document):
    extension = document.file.name.rsplit('.', 1)[-1].lower() if '.' in document.file.name else ''
    return {value: key for key, value in EXTENSION_BY_KIND.items()}.get(extension)


class Command(BaseCommand):
    help = 'Repasse au moteur antivirus les documents « non analysés » (dérogation T15, PO-2026-09-30-07).'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Compte les documents à analyser, sans rien modifier.')

    def handle(self, *args, **options):
        if antivirus_waived():
            raise CommandError(
                'Dérogation DÉMO encore active (moteur non configuré) : configurer KEYA_CLAMD_ADDRESS avant '
                'l’analyse rétroactive.',
            )
        totals = {'analyse': 0, 'infecte': 0}
        pending = 0
        for organization in Organization.objects.all():
            with transaction.atomic():
                set_rls_context(organization_id=organization.id)
                documents = list(Document.objects.filter(
                    organization=organization, antivirus_status=AntivirusStatus.NON_ANALYSE,
                ).order_by('created_at'))
                pending += len(documents)
                if options['dry_run']:
                    continue
                for document in documents:
                    self._rescan(document, totals)
        if options['dry_run']:
            self.stdout.write(f'{pending} document(s) non analysé(s) ; rien n’a été modifié (--dry-run).')
            return
        self.stdout.write(
            f'{pending} document(s) repassé(s) : {totals["analyse"]} sain(s), {totals["infecte"]} détecté(s).',
        )
        if totals['infecte']:
            self.stdout.write(self.style.WARNING('Documents détectés : plus servis ; voir le journal (« Document détecté »).'))

    def _rescan(self, document, totals):
        try:
            with document.file.open('rb') as handle:
                data = handle.read()
        except (FileNotFoundError, OSError):
            self.stdout.write(self.style.WARNING(f'Fichier absent pour le document {document.id} : ignoré.'))
            return
        try:
            scan_data(data, _kind(document))
        except ScanUnavailable:
            raise CommandError('Moteur antivirus injoignable : analyse interrompue ; les documents non traités restent « non analysés ».')
        except ScanRejected as rejection:
            document.antivirus_status = AntivirusStatus.INFECTE
            document.save(update_fields=['antivirus_status'])
            audit_services.record(
                organization_id=document.organization_id, actor=None, action=QUARANTINED, obj=document,
                payload={'reason': rejection.reason, 'detail': rejection.detail[:200], 'sha256': document.hash},
            )
            totals['infecte'] += 1
            return
        document.antivirus_status = AntivirusStatus.ANALYSE
        document.save(update_fields=['antivirus_status'])
        audit_services.record(
            organization_id=document.organization_id, actor=None, action=RESCANNED_CLEAN, obj=document,
            payload={'sha256': document.hash},
        )
        totals['analyse'] += 1
