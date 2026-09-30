"""PO-2026-09-29-13 (T15, CDC §10 « analyser les dépôts et ne pas rendre
disponible un fichier en attente ou rejeté ») — tout fichier déposé est
analysé AVANT d'être stocké.

Constat de la revue assistée (docs/recette/REVUE_ASSISTEE_R1.md) : un
fichier au format conforme était enregistré et disponible dès son dépôt,
sans aucune analyse.

L'analyse se fait pendant la requête de dépôt, avant `create_document` :
un fichier n'est donc jamais « en attente » — il est analysé et accepté,
ou refusé sans que rien ne soit écrit (ni fichier, ni Document). Deux
étapes, dans cet ordre :

1. Analyse du contenu PDF (sans dépendance externe) : refus d'un PDF
   portant du contenu actif (JavaScript, lancement de programme, fichier
   embarqué, média riche, formulaire XFA), y compris caché dans un flux
   d'objets compressé ou derrière un nom encodé (`/J#61vaScript`), et d'un
   PDF chiffré (son contenu ne peut pas être analysé). Les images sont déjà
   décodées en entier par `validators.py` puis ré-encodées (tasks.py).
2. Antivirus : le fichier est transmis au moteur ClamAV (`clamd`,
   commande INSTREAM) configuré par `KEYA_CLAMD_ADDRESS`.

Fermeture par défaut : moteur non configuré, injoignable, en erreur ou
réponse illisible → dépôt refusé (503), rien d'enregistré. Aucun réglage
d'environnement ne désactive l'analyse (`KEYA_UPLOAD_ANTIVIRUS` ne se
change que dans le code des réglages : settings_test.py).
"""
import hashlib
import logging
import re
import socket
import struct
import zlib

from django.conf import settings
from django.utils.module_loading import import_string
from rest_framework import serializers, status
from rest_framework.exceptions import APIException

logger = logging.getLogger(__name__)

REJECTED_MESSAGE = 'Fichier refusé : l’analyse a détecté un contenu dangereux. Rien n’a été enregistré.'
ACTIVE_PDF_MESSAGE = (
    'Fichier refusé : ce PDF contient du contenu actif (script, programme ou fichier embarqué). '
    'Rien n’a été enregistré.'
)
ENCRYPTED_PDF_MESSAGE = (
    'Fichier refusé : PDF chiffré ou protégé, impossible à analyser. '
    'Déposez une version non protégée. Rien n’a été enregistré.'
)
UNANALYSABLE_MESSAGE = 'Fichier refusé : contenu impossible à analyser. Rien n’a été enregistré.'
UNAVAILABLE_MESSAGE = (
    'Analyse des fichiers momentanément indisponible : dépôt refusé, rien n’a été enregistré. '
    'Réessayez plus tard.'
)

AUDIT_ACTION = 'document.upload_rejected'

# Noms PDF qui portent une exécution ou un contenu caché (CDC §10 « refuser
# les formats actifs »). Les liens `/URI`, formulaires simples et
# `/OpenAction` (zoom à l'ouverture) restent admis : ils n'exécutent rien
# sans l'un de ces noms.
ACTIVE_PDF_NAMES = frozenset({
    'JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia', 'XFA', 'GoToE',
})
_PDF_NAME = re.compile(rb'/([^\s/<>\[\]()%{}]+)')
_PDF_HEX_ESCAPE = re.compile(rb'#([0-9A-Fa-f]{2})')
# Corps d'un flux (données binaires : images, contenu de page) — exclu de la
# recherche de noms, où des octets quelconques formeraient au hasard `/JS`.
# Parcours linéaire (`_stream_bodies`) : une expression `stream.*?endstream`
# deviendrait quadratique sur un fichier piégé (des milliers de `stream`
# sans `endstream`) et bloquerait le serveur.
_STREAM_START = re.compile(rb'(?<!end)stream\r?\n')
_FLATE = frozenset({'FlateDecode', 'Fl'})
_FILTERS = frozenset({
    'FlateDecode', 'Fl', 'ASCIIHexDecode', 'AHx', 'ASCII85Decode', 'A85', 'LZWDecode', 'LZW',
    'RunLengthDecode', 'RL', 'CCITTFaxDecode', 'CCF', 'DCTDecode', 'DCT', 'JBIG2Decode', 'JPXDecode', 'Crypt',
})
# Plafond de décompression d'un flux d'objets : au-delà, le fichier n'est
# pas analysable (bombe de décompression) et il est refusé.
MAX_INFLATED_BYTES = 16 * 1024 * 1024
CLAMD_CHUNK_BYTES = 64 * 1024


class ScanUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = UNAVAILABLE_MESSAGE
    default_code = 'scan_unavailable'


class ScanRejected(Exception):
    def __init__(self, reason, message, detail=''):
        super().__init__(message)
        self.reason, self.message, self.detail = reason, message, detail


def _names(data):
    found = set()
    for raw in _PDF_NAME.findall(data):
        found.add(_PDF_HEX_ESCAPE.sub(lambda m: bytes([int(m.group(1), 16)]), raw).decode('latin-1'))
    return found


def _stream_bodies(data):
    """(début du mot-clé `stream`, début du corps, fin du corps) de chaque
    flux, dans l'ordre ; un flux sans `endstream` court jusqu'à la fin."""
    position = 0
    while True:
        match = _STREAM_START.search(data, position)
        if match is None:
            return
        end = data.find(b'endstream', match.end())
        end = len(data) if end < 0 else end
        yield match.start(), match.end(), end
        position = end + len(b'endstream')


def _outside_streams(data):
    parts, position = [], 0
    for keyword, _body, end in _stream_bodies(data):
        parts.append(data[position:keyword])
        position = end + len(b'endstream')
    parts.append(data[position:])
    return b' '.join(parts)


def _object_streams(data):
    """Contenu décompressé des flux d'objets (`/Type /ObjStm`), où un PDF
    peut ranger ses dictionnaires — donc ses noms — hors du texte brut."""
    for keyword, body_start, body_end in _stream_bodies(data):
        start = data.rfind(b'obj', 0, keyword)
        dictionary = _names(data[start if start >= 0 else 0:keyword])
        if 'ObjStm' not in dictionary:
            continue
        body = data[body_start:body_end]
        filters = dictionary & _FILTERS
        if not filters:
            yield body
            continue
        if not filters <= _FLATE:
            raise ScanRejected('non_analysable', UNANALYSABLE_MESSAGE, 'flux d’objets à filtre non pris en charge')
        inflater = zlib.decompressobj()
        try:
            inflated = inflater.decompress(body, MAX_INFLATED_BYTES)
        except zlib.error:
            raise ScanRejected('non_analysable', UNANALYSABLE_MESSAGE, 'flux d’objets illisible')
        if inflater.unconsumed_tail:
            raise ScanRejected('non_analysable', UNANALYSABLE_MESSAGE, 'flux d’objets trop volumineux')
        yield inflated


def analyse_pdf(data):
    """Lève `ScanRejected` pour un PDF chiffré ou portant du contenu actif.
    Noms cherchés dans les dictionnaires (hors corps des flux) et dans les
    flux d'objets décompressés."""
    names = _names(_outside_streams(data))
    if 'Encrypt' in names:
        raise ScanRejected('pdf_chiffre', ENCRYPTED_PDF_MESSAGE, 'Encrypt')
    for inflated in _object_streams(data):
        names |= _names(inflated)
    active = sorted(names & ACTIVE_PDF_NAMES)
    if active:
        raise ScanRejected('contenu_actif', ACTIVE_PDF_MESSAGE, ', '.join(active))


def _clamd_connect(address, timeout):
    if address.startswith('unix:'):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            sock.settimeout(timeout)
            sock.connect(address[len('unix:'):])
        except OSError:
            sock.close()
            raise
        return sock
    host, _, port = address.removeprefix('tcp:').rpartition(':')
    return socket.create_connection((host, int(port)), timeout=timeout)


def clamd_scan(data):
    """Antivirus ClamAV (`clamd`, commande INSTREAM). Renvoie `None` si le
    fichier est sain, le nom de la signature détectée sinon ; lève
    `ScanUnavailable` dans tout autre cas (fermeture par défaut)."""
    address = getattr(settings, 'KEYA_CLAMD_ADDRESS', '')
    if not address:
        logger.error('upload_scan_unavailable reason=clamd_not_configured')
        raise ScanUnavailable()
    try:
        with _clamd_connect(address, settings.KEYA_CLAMD_TIMEOUT_SECONDS) as sock:
            sock.sendall(b'zINSTREAM\0')
            for start in range(0, len(data), CLAMD_CHUNK_BYTES):
                chunk = data[start:start + CLAMD_CHUNK_BYTES]
                sock.sendall(struct.pack('!L', len(chunk)) + chunk)
            sock.sendall(struct.pack('!L', 0))
            reply = b''
            while not reply.endswith(b'\0'):
                part = sock.recv(4096)
                if not part:
                    break
                reply += part
    except (OSError, ValueError) as exc:
        logger.error('upload_scan_unavailable reason=clamd_unreachable error=%s', type(exc).__name__)
        raise ScanUnavailable()
    answer = reply.rstrip(b'\0').decode('utf-8', 'replace').strip()
    if answer == 'stream: OK':
        return None
    if answer.startswith('stream: ') and answer.endswith(' FOUND'):
        return answer[len('stream: '):-len(' FOUND')]
    logger.error('upload_scan_unavailable reason=clamd_error answer=%s', answer[:200])
    raise ScanUnavailable()


def scan_before_storage(uploaded_file, kind):
    """Analyse complète ; renvoie l'empreinte sha256 du fichier analysé.
    Lève `ScanRejected` (contenu refusé) ou `ScanUnavailable`."""
    uploaded_file.seek(0)
    data = uploaded_file.read()
    uploaded_file.seek(0)
    if kind == 'pdf':
        analyse_pdf(data)
    signature = import_string(settings.KEYA_UPLOAD_ANTIVIRUS)(data)
    if signature:
        raise ScanRejected('antivirus', REJECTED_MESSAGE, signature)
    uploaded_file.keya_scanned_sha256 = hashlib.sha256(data).hexdigest()
    return uploaded_file.keya_scanned_sha256


def ensure_scanned(uploaded_file, kind):
    """Garde de `services.create_document` : un fichier qui n'a pas été
    analysé par la requête de dépôt (appel direct du service) l'est ici,
    avant tout stockage."""
    if getattr(uploaded_file, 'keya_scanned_sha256', None):
        return
    try:
        scan_before_storage(uploaded_file, kind)
    except ScanRejected as rejection:
        raise serializers.ValidationError({'file': [rejection.message]})


def validate_upload(uploaded_file, request):
    """Étape de validation des deux chemins de dépôt HTTP (après le contrôle
    de format de `validators.validate_document_file`). Un refus est inscrit
    au journal d'audit de l'organisation active du déposant, sans le
    contenu du fichier : motif, signature ou noms détectés, empreinte,
    taille."""
    from .validators import detect_document_kind

    kind = detect_document_kind(uploaded_file)
    try:
        scan_before_storage(uploaded_file, kind)
    except ScanRejected as rejection:
        _record_rejection(request, uploaded_file, kind, rejection)
        raise serializers.ValidationError(rejection.message)
    return uploaded_file


def _record_rejection(request, uploaded_file, kind, rejection):
    uploaded_file.seek(0)
    digest = hashlib.sha256(uploaded_file.read()).hexdigest()
    uploaded_file.seek(0)
    logger.warning('upload_rejected reason=%s detail=%s sha256=%s', rejection.reason, rejection.detail, digest)
    user = getattr(request, 'user', None)
    organization = getattr(request, 'organization', None)
    if user is None or not user.is_authenticated or organization is None:
        return
    from apps.audit.models import AuditEvent

    match = getattr(request, 'resolver_match', None)
    AuditEvent.objects.create(
        organization_id=organization.id,
        actor=user,
        action=AUDIT_ACTION,
        object_type='document.upload',
        object_id=user.pk,
        payload={
            'reason': rejection.reason,
            'detail': rejection.detail[:200],
            'sha256': digest,
            'size': uploaded_file.size,
            'kind': kind or '',
            'route': match.url_name if match and match.url_name else '',
        },
    )
