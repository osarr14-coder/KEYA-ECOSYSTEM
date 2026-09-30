"""PO-2026-09-29-13 (T15, CDC §10) — tout dépôt est analysé avant stockage ;
refus (ou analyse indisponible) : rien d'enregistré, refus tracé."""
import os
import socket
import struct
import threading
import zlib

import pytest
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse

from apps.audit.models import AuditEvent
from apps.control.tests import _jpeg_file, _setup_constructeur_org, _setup_inspecteur
from apps.core.rls import set_rls_context
from apps.evidence import scanning
from apps.evidence.models import Document
from apps.evidence.testing import EICAR, EICAR_SIGNATURE
from apps.evidence.tests import _setup_org, _upload_document


def _pdf(*objects, trailer=b''):
    body = b'%PDF-1.7\n'
    for number, content in enumerate(objects, start=1):
        body += b'%d 0 obj\n' % number + content + b'\nendobj\n'
    return body + b'trailer\n<< /Root 1 0 R ' + trailer + b'>>\n%%EOF\n'


def _pdf_file(body, name='plan.pdf'):
    return SimpleUploadedFile(name, body, content_type='application/pdf')


def _stored_files():
    root = settings.MEDIA_ROOT
    return sum(len(files) for _dir, _dirs, files in os.walk(root)) if os.path.isdir(root) else 0


def _object_stream(content):
    packed = zlib.compress(content)
    return (
        b'<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length %d >>\nstream\n' % len(packed)
        + packed + b'\nendstream'
    )


CLEAN_PDF = _pdf(b'<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] >>', b'<< /Type /Pages /Kids [] /Count 0 >>')
ACTIVE_PDFS = {
    'javascript': _pdf(b'<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>'),
    'nom encodé': _pdf(b'<< /Type /Catalog /OpenAction << /S /J#61vaScript /J#53 (x) >> >>'),
    'lancement': _pdf(b'<< /Type /Catalog /OpenAction << /S /Launch /F (calc.exe) >> >>'),
    'fichier embarqué': _pdf(b'<< /Type /Catalog /Names << /EmbeddedFiles 2 0 R >> >>'),
    'caché dans un flux d’objets': _pdf(
        b'<< /Type /Catalog /OpenAction 2 0 R >>',
        _object_stream(b'3 0 << /S /JavaScript /JS (app.alert(1)) >>'),
    ),
}


def _rejections(organization):
    set_rls_context(organization_id=organization.id)
    return list(AuditEvent.objects.filter(organization=organization, action=scanning.AUDIT_ACTION))


@pytest.mark.django_db
class TestUploadScanDocuments:
    def test_a_clean_pdf_with_an_open_action_is_accepted(self):
        client, organization, _user, _milestone = _setup_org('scan-clean@example.com', 'Org Scan Clean')
        response = _upload_document(client, upload_file=_pdf_file(CLEAN_PDF))
        assert response.status_code == 201, response.data
        assert _rejections(organization) == []

    def test_binary_stream_data_is_not_read_as_pdf_names(self):
        """Un corps de flux (image) contenant par hasard `/JS ` n'est pas du
        contenu actif : seuls les dictionnaires sont examinés."""
        client, _organization, _user, _milestone = _setup_org('scan-binary@example.com', 'Org Scan Binary')
        image = b'\x00\xff/JS /Launch\x10\x00' * 50
        body = _pdf(
            b'<< /Type /Catalog >>',
            b'<< /Type /XObject /Subtype /Image /Filter /DCTDecode /Length %d >>\nstream\n' % len(image)
            + image + b'\nendstream',
        )
        response = _upload_document(client, upload_file=_pdf_file(body))
        assert response.status_code == 201, response.data

    def test_a_pdf_with_active_content_is_refused_traced_and_not_stored(self):
        client, organization, user, _milestone = _setup_org('scan-active@example.com', 'Org Scan Active')
        files_before = _stored_files()
        for label, body in ACTIVE_PDFS.items():
            response = _upload_document(client, upload_file=_pdf_file(body))
            assert response.status_code == 400, label
            assert str(response.data['file'][0]) == scanning.ACTIVE_PDF_MESSAGE, label
        set_rls_context(organization_id=organization.id)
        assert not Document.objects.filter(organization=organization).exists()
        assert _stored_files() == files_before
        events = _rejections(organization)
        assert len(events) == len(ACTIVE_PDFS)
        assert {event.payload['reason'] for event in events} == {'contenu_actif'}
        assert all(event.actor_id == user.id and event.payload['kind'] == 'pdf' for event in events)
        assert 'JavaScript' in events[0].payload['detail']
        assert 'app.alert' not in str([event.payload for event in events])  # rien du contenu recopié

    def test_an_encrypted_pdf_is_refused_as_not_analysable(self):
        client, organization, _user, _milestone = _setup_org('scan-encrypt@example.com', 'Org Scan Encrypt')
        body = _pdf(b'<< /Type /Catalog >>', b'<< /Filter /Standard /V 2 >>', trailer=b'/Encrypt 2 0 R ')
        response = _upload_document(client, upload_file=_pdf_file(body))
        assert response.status_code == 400
        assert str(response.data['file'][0]) == scanning.ENCRYPTED_PDF_MESSAGE
        assert _rejections(organization)[0].payload['reason'] == 'pdf_chiffre'

    def test_an_object_stream_that_cannot_be_inflated_is_refused(self):
        client, _organization, _user, _milestone = _setup_org('scan-broken@example.com', 'Org Scan Broken')
        body = _pdf(b'<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 9 >>\nstream\nnot-zlib!\nendstream')
        response = _upload_document(client, upload_file=_pdf_file(body))
        assert response.status_code == 400
        assert str(response.data['file'][0]) == scanning.UNANALYSABLE_MESSAGE

    def test_a_trapped_pdf_is_analysed_in_linear_time(self):
        """Des milliers de `stream` sans `endstream` : l'analyse reste
        linéaire (une expression non gourmande prenait des minutes)."""
        import time

        body = b'%PDF-1.4\n' + b'1 0 obj << /Type /ObjStm >> stream\n' * 250_000
        started = time.monotonic()
        scanning.analyse_pdf(body)  # aucun contenu actif : accepté, mais vite
        assert time.monotonic() - started < 5

    def test_a_file_flagged_by_the_antivirus_is_refused_traced_and_not_stored(self):
        client, organization, _user, _milestone = _setup_org('scan-virus@example.com', 'Org Scan Virus')
        files_before = _stored_files()
        response = _upload_document(client, upload_file=_pdf_file(b'%PDF-1.4\n%' + EICAR + b'\n%%EOF\n'))
        assert response.status_code == 400
        assert str(response.data['file'][0]) == scanning.REJECTED_MESSAGE
        set_rls_context(organization_id=organization.id)
        assert not Document.objects.filter(organization=organization).exists()
        assert _stored_files() == files_before
        [event] = _rejections(organization)
        assert event.payload['reason'] == 'antivirus'
        assert event.payload['detail'] == EICAR_SIGNATURE
        assert len(event.payload['sha256']) == 64

    def test_an_image_carrying_the_test_virus_is_refused(self):
        client, _organization, _user, _milestone = _setup_org('scan-png@example.com', 'Org Scan Png')
        jpeg = _jpeg_file().read()  # JPEG réel, suivi de la charge
        response = _upload_document(
            client, upload_file=SimpleUploadedFile('photo.jpg', jpeg + EICAR, content_type='image/jpeg'),
        )
        assert response.status_code == 400
        assert str(response.data['file'][0]) == scanning.REJECTED_MESSAGE

    @override_settings(KEYA_UPLOAD_ANTIVIRUS='apps.evidence.scanning.clamd_scan', KEYA_CLAMD_ADDRESS='')
    def test_without_an_antivirus_engine_every_upload_is_refused_and_nothing_is_stored(self):
        client, organization, _user, _milestone = _setup_org('scan-none@example.com', 'Org Scan None')
        files_before = _stored_files()
        response = _upload_document(client, upload_file=_pdf_file(CLEAN_PDF))
        assert response.status_code == 503
        assert str(response.data['detail']) == scanning.UNAVAILABLE_MESSAGE
        set_rls_context(organization_id=organization.id)
        assert not Document.objects.filter(organization=organization).exists()
        assert _stored_files() == files_before

    def test_the_service_scans_a_file_that_did_not_come_through_an_upload(self):
        from rest_framework.exceptions import ValidationError

        from apps.evidence.services import create_document

        _client, organization, user, _milestone = _setup_org('scan-service@example.com', 'Org Scan Service')
        set_rls_context(organization_id=organization.id, user_id=user.id)
        with pytest.raises(ValidationError):
            create_document(
                organization=organization, owner=user, uploaded_file=_pdf_file(ACTIVE_PDFS['javascript']),
                category='plan', source='web',
            )
        assert not Document.objects.filter(organization=organization).exists()


@pytest.mark.django_db
def test_the_control_sync_path_is_scanned_too():
    _c, constructeur_organization, _u, _lot, _declaration = _setup_constructeur_org(
        'scan-sync-constructeur@example.com', 'Org Scan Sync Constructeur',
    )
    inspecteur_client, inspecteur_organization, _i = _setup_inspecteur(
        'scan-sync-inspecteur@example.com', 'Org Scan Sync Inspecteur',
    )
    set_rls_context(organization_id=constructeur_organization.id)
    before = Document.objects.filter(organization=constructeur_organization).count()
    response = inspecteur_client.post(
        reverse('control-sync-document'),
        {
            'organization': str(constructeur_organization.id),
            'file': SimpleUploadedFile('facade.jpg', _jpeg_file().read() + EICAR, content_type='image/jpeg'),
            'category': 'photo_inspection',
            'source': 'mobile_app_photo',
            'correlation_id': '55555555-5555-5555-5555-5555555555ab',
        },
        format='multipart',
    )
    assert response.status_code == 400
    assert str(response.data['file'][0]) == scanning.REJECTED_MESSAGE
    set_rls_context(organization_id=constructeur_organization.id)
    assert Document.objects.filter(organization=constructeur_organization).count() == before
    assert _rejections(inspecteur_organization)[0].payload['route'] == 'control-sync-document'


class _FakeClamd:
    """Faux `clamd` TCP : vérifie le protocole INSTREAM et répond `reply`."""

    def __init__(self, reply):
        self.reply, self.received = reply, b''
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen(1)
        self.address = '127.0.0.1:%d' % self.server.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _read(self, conn, size):
        data = b''
        while len(data) < size:
            part = conn.recv(size - len(data))
            if not part:
                raise ConnectionError
            data += part
        return data

    def _serve(self):
        conn, _ = self.server.accept()
        with conn:
            assert self._read(conn, 10) == b'zINSTREAM\0'
            while True:
                (length,) = struct.unpack('!L', self._read(conn, 4))
                if length == 0:
                    break
                self.received += self._read(conn, length)
            conn.sendall(self.reply)
        self.server.close()


class TestClamdClient:
    def test_clean_infected_and_error_answers(self):
        payload = b'x' * (scanning.CLAMD_CHUNK_BYTES * 2 + 5)  # plusieurs blocs
        fake = _FakeClamd(b'stream: OK\0')
        with override_settings(KEYA_CLAMD_ADDRESS=fake.address):
            assert scanning.clamd_scan(payload) is None
        fake.thread.join(5)
        assert fake.received == payload

        fake = _FakeClamd(b'stream: Win.Test.EICAR_HDB-1 FOUND\0')
        with override_settings(KEYA_CLAMD_ADDRESS=fake.address):
            assert scanning.clamd_scan(EICAR) == 'Win.Test.EICAR_HDB-1'

        fake = _FakeClamd(b'INSTREAM size limit exceeded. ERROR\0')
        with override_settings(KEYA_CLAMD_ADDRESS=fake.address), pytest.raises(scanning.ScanUnavailable):
            scanning.clamd_scan(payload)

    def test_an_unreachable_engine_fails_closed(self):
        unused = socket.socket()
        unused.bind(('127.0.0.1', 0))
        port = unused.getsockname()[1]
        unused.close()
        with override_settings(KEYA_CLAMD_ADDRESS=f'127.0.0.1:{port}'), pytest.raises(scanning.ScanUnavailable):
            scanning.clamd_scan(b'data')
        with override_settings(KEYA_CLAMD_ADDRESS='unix:/nonexistent/clamd.ctl'), pytest.raises(scanning.ScanUnavailable):
            scanning.clamd_scan(b'data')

    def test_the_production_settings_use_clamd(self):
        """Le moteur n'est pas réglable par l'environnement : settings.py
        désigne toujours clamd (seul settings_test.py le remplace)."""
        source = open(os.path.join(settings.BASE_DIR, 'config', 'settings.py'), encoding='utf-8').read()
        assert "KEYA_UPLOAD_ANTIVIRUS = 'apps.evidence.scanning.clamd_scan'" in source
        assert "config('KEYA_UPLOAD_ANTIVIRUS'" not in source
