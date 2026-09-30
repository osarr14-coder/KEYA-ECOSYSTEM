"""PO-2026-09-30-07 (dérogation T15, CDC §11) — en DÉMO, sans moteur, les
dépôts sont acceptés sans antivirus mais tracés ; l'analyse du contenu PDF
reste faite ; hors DÉMO la dérogation n'existe pas ; l'analyse rétroactive
repasse les documents au moteur dès qu'il est branché."""
import os
import subprocess
import sys

import pytest
from django.conf import settings
from django.core.management import CommandError, call_command
from django.test import override_settings
from django.urls import reverse

from apps.audit.models import AuditEvent
from apps.core.rls import set_rls_context
from apps.evidence import scanning
from apps.evidence.models import AntivirusStatus, Document
from apps.evidence.test_upload_scan import ACTIVE_PDFS, CLEAN_PDF, _FakeClamd, _pdf_file
from apps.evidence.testing import EICAR
from apps.evidence.tests import _setup_org, _upload_document

WAIVER = dict(
    KEYA_DEMO_UPLOADS_WITHOUT_ANTIVIRUS=True, KEYA_ENVIRONMENT='DEMO',
    KEYA_CLAMD_ADDRESS='', KEYA_UPLOAD_ANTIVIRUS='apps.evidence.scanning.clamd_scan',
)
EICAR_PDF = b'%PDF-1.4\n%' + EICAR + b'\n%%EOF\n'


def _document(organization, document_id):
    set_rls_context(organization_id=organization.id)
    return Document.objects.get(id=document_id)


def _events(organization, action):
    set_rls_context(organization_id=organization.id)
    return list(AuditEvent.objects.filter(organization=organization, action=action))


@pytest.mark.django_db
class TestDemoWaiver:
    def test_a_scanned_upload_is_marked_analysed(self):
        client, organization, _user, _milestone = _setup_org('waiver-normal@example.com', 'Org Waiver Normal')
        response = _upload_document(client, upload_file=_pdf_file(CLEAN_PDF))
        assert response.status_code == 201
        assert _document(organization, response.data['id']).antivirus_status == AntivirusStatus.ANALYSE
        assert _events(organization, scanning.ACCEPTED_WITHOUT_ANTIVIRUS) == []

    @override_settings(**WAIVER)
    def test_without_engine_in_demo_the_upload_is_accepted_unscanned_and_traced(self):
        client, organization, user, _milestone = _setup_org('waiver-on@example.com', 'Org Waiver On')
        response = _upload_document(client, upload_file=_pdf_file(CLEAN_PDF))
        assert response.status_code == 201
        document = _document(organization, response.data['id'])
        assert document.antivirus_status == AntivirusStatus.NON_ANALYSE
        [event] = _events(organization, scanning.ACCEPTED_WITHOUT_ANTIVIRUS)
        assert event.actor_id == user.id and str(event.object_id) == str(document.id)
        assert event.payload['sha256'] == document.hash
        assert event.payload['derogation'] == 'PO-2026-09-30-07'

    @override_settings(**WAIVER)
    def test_the_pdf_content_analysis_still_applies_under_the_waiver(self):
        client, organization, _user, _milestone = _setup_org('waiver-active@example.com', 'Org Waiver Active')
        response = _upload_document(client, upload_file=_pdf_file(ACTIVE_PDFS['javascript']))
        assert response.status_code == 400
        assert str(response.data['file'][0]) == scanning.ACTIVE_PDF_MESSAGE
        set_rls_context(organization_id=organization.id)
        assert not Document.objects.filter(organization=organization).exists()

    @override_settings(**{**WAIVER, 'KEYA_ENVIRONMENT': 'PILOTE'})
    def test_outside_demo_there_is_no_waiver(self):
        """Double garde : les réglages refusent déjà de démarrer ainsi."""
        client, organization, _user, _milestone = _setup_org('waiver-pilote@example.com', 'Org Waiver Pilote')
        response = _upload_document(client, upload_file=_pdf_file(CLEAN_PDF))
        assert response.status_code == 503
        set_rls_context(organization_id=organization.id)
        assert not Document.objects.filter(organization=organization).exists()

    def test_a_configured_engine_is_always_used(self):
        client, organization, _user, _milestone = _setup_org('waiver-engine@example.com', 'Org Waiver Engine')
        fake = _FakeClamd(b'stream: OK\0')
        with override_settings(**{**WAIVER, 'KEYA_CLAMD_ADDRESS': fake.address}):
            response = _upload_document(client, upload_file=_pdf_file(CLEAN_PDF))
        assert response.status_code == 201
        assert _document(organization, response.data['id']).antivirus_status == AntivirusStatus.ANALYSE


@pytest.mark.django_db
class TestRetroactiveScan:
    def test_unscanned_documents_are_rescanned_once_the_engine_is_there(self, capsys):
        client, organization, _user, _milestone = _setup_org('rescan@example.com', 'Org Rescan')
        with override_settings(**WAIVER):
            clean_id = _upload_document(client, upload_file=_pdf_file(CLEAN_PDF)).data['id']
            virus = _upload_document(client, upload_file=_pdf_file(EICAR_PDF))
        # Sous la dérogation, le fichier de test antivirus passe : c'est la limite assumée.
        assert virus.status_code == 201
        virus_id = virus.data['id']
        signed = client.get(reverse('document-signed-url', args=[virus_id])).data['url']
        assert client.get(signed).status_code == 200

        call_command('rescan_unscanned_documents', '--dry-run')
        assert '2 document(s) non analysé(s)' in capsys.readouterr().out
        assert _document(organization, virus_id).antivirus_status == AntivirusStatus.NON_ANALYSE

        # Moteur branché (celui des tests ne connaît que EICAR).
        call_command('rescan_unscanned_documents')
        assert '2 document(s) repassé(s) : 1 sain(s), 1 détecté(s)' in capsys.readouterr().out
        assert _document(organization, clean_id).antivirus_status == AntivirusStatus.ANALYSE
        assert _document(organization, virus_id).antivirus_status == AntivirusStatus.INFECTE
        [quarantined] = _events(organization, scanning.QUARANTINED)
        assert str(quarantined.object_id) == str(virus_id) and quarantined.payload['reason'] == 'antivirus'
        assert len(_events(organization, scanning.RESCANNED_CLEAN)) == 1
        # Plus servi, même avec un lien signé obtenu avant.
        assert client.get(signed).status_code == 404

    @override_settings(**WAIVER)
    def test_the_rescan_refuses_to_run_without_an_engine(self):
        with pytest.raises(CommandError, match='Dérogation DÉMO encore active'):
            call_command('rescan_unscanned_documents')


def _settings_import(**env):
    code = 'import django; django.setup(); from django.conf import settings; print(settings.KEYA_ENVIRONMENT)'
    environ = {**os.environ, 'DJANGO_SETTINGS_MODULE': 'config.settings', **env}
    return subprocess.run(
        [sys.executable, '-c', code], cwd=settings.BASE_DIR, env=environ, capture_output=True, text=True, timeout=120,
    )


class TestStartupGuard:
    def test_the_waiver_refuses_to_start_outside_demo(self):
        for environment in ('PILOTE', 'PRODUCTION'):
            run = _settings_import(KEYA_ENVIRONMENT=environment, KEYA_DEMO_UPLOADS_WITHOUT_ANTIVIRUS='True')
            assert run.returncode != 0
            assert 'réservé à la DÉMO' in run.stderr

    def test_the_waiver_starts_in_demo_and_an_unknown_environment_is_refused(self):
        run = _settings_import(KEYA_ENVIRONMENT='DEMO', KEYA_DEMO_UPLOADS_WITHOUT_ANTIVIRUS='True')
        assert run.returncode == 0, run.stderr
        assert run.stdout.strip() == 'DEMO'
        run = _settings_import(KEYA_ENVIRONMENT='RECETTE')
        assert run.returncode != 0 and 'KEYA_ENVIRONMENT inconnu' in run.stderr
