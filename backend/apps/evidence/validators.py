"""Validation d'upload de documents — tickets B-046 puis B-047 (durcissement
après revue indépendante). Vérifie le CONTENU réel du fichier : magic bytes
`%PDF-` pour un PDF, décodage Pillow réel pour une image JPEG/PNG.

PO-2026-09-29-05 (T15, CDC §10) : l'extension du nom et le `Content-Type`
déclaré, choisis par le client, ne suffisent jamais seuls — mais ils doivent
CONCORDER avec le contenu réel ; sinon le dépôt est refusé. Le nom stocké
reste neutralisé (`document.<type détecté>`).
"""

from django.core.exceptions import ValidationError
from PIL import Image
from rest_framework import serializers

MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 Mo, CDC §10

PDF_MAGIC_BYTES = b'%PDF-'

# `MPO` : JPEG multi-images (photos HDR/profondeur de smartphones récents),
# lisible comme un JPEG ordinaire — le refuser rejetait de vraies photos.
_PILLOW_FORMAT_TO_KIND = {'JPEG': 'jpeg', 'MPO': 'jpeg', 'PNG': 'png'}

IMAGE_KINDS = frozenset({'jpeg', 'png'})

EXTENSION_BY_KIND = {'pdf': 'pdf', 'jpeg': 'jpg', 'png': 'png'}

# Plafonds vérifiés sur l'EN-TÊTE, avant tout décodage : un PNG de 17 Ko
# annonçant 144 Mpx passait la validation B-046 et faisait monter le
# traitement miniature (apps/evidence/tasks.py) à 1,2 Go — l'instance Render
# free en a 512 (B-047, reproduit par la revue). JPEG plus haut que PNG :
# décodé en mode réduit (`draft`), son coût mémoire ne suit pas sa
# résolution nominale ; 50 Mpx couvre les modes pleine résolution des
# capteurs 48/50 Mpx. PNG décodé en pleine résolution, d'où 25 Mpx.
MAX_PIXELS_BY_KIND = {'jpeg': 50_000_000, 'png': 25_000_000}

# PO-2026-09-29-05 (T15, CDC §10, révise la règle du ticket B-047) : un
# dépôt n'est accepté que si l'EXTENSION du nom, le TYPE déclaré et le
# CONTENU réel concordent ; tout autre cas est refusé, sans stockage.
UNSUPPORTED_FORMAT_MESSAGE = 'Format non autorisé : seuls PDF, JPEG et PNG sont acceptés'
KIND_BY_EXTENSION = {'pdf': 'pdf', 'jpg': 'jpeg', 'jpeg': 'jpeg', 'png': 'png'}
DECLARED_TYPES_BY_KIND = {
    'pdf': frozenset({'application/pdf'}),
    'jpeg': frozenset({'image/jpeg', 'image/jpg', 'image/pjpeg'}),
    'png': frozenset({'image/png'}),
}
CORRUPTED_IMAGE_MESSAGE = 'Image illisible ou corrompue.'
UPLOAD_TOO_LARGE_MESSAGE = f'Fichier trop volumineux — {MAX_UPLOAD_SIZE_BYTES} octets maximum.'


def detect_document_kind(uploaded_file):
    """`'pdf'`, `'jpeg'`, `'png'` ou `None`, d'après l'en-tête seul (aucun
    décodage de pixels). Laisse toujours le pointeur de fichier à 0 :
    `services.create_document` en calcule ensuite le sha256.
    """
    uploaded_file.seek(0)
    try:
        if uploaded_file.read(len(PDF_MAGIC_BYTES)) == PDF_MAGIC_BYTES:
            return 'pdf'
        uploaded_file.seek(0)
        try:
            with Image.open(uploaded_file) as image:
                return _PILLOW_FORMAT_TO_KIND.get(image.format)
        except Exception:
            return None
    finally:
        uploaded_file.seek(0)


def expected_kind(uploaded_file):
    """Type attendu d'après l'extension ET le type déclaré, `None` s'ils ne
    désignent pas le même format autorisé (PO-2026-09-29-05)."""
    name = (getattr(uploaded_file, 'name', '') or '').lower()
    extension = name.rsplit('.', 1)[-1] if '.' in name else ''
    kind = KIND_BY_EXTENSION.get(extension)
    declared = (getattr(uploaded_file, 'content_type', '') or '').split(';')[0].strip().lower()
    if kind is None or declared not in DECLARED_TYPES_BY_KIND[kind]:
        return None
    return kind


def validate_document_file(uploaded_file):
    if uploaded_file.size > MAX_UPLOAD_SIZE_BYTES:
        raise ValidationError(UPLOAD_TOO_LARGE_MESSAGE)

    # PO-2026-09-29-05 : extension, type déclaré et contenu réel concordent.
    expected = expected_kind(uploaded_file)
    kind = detect_document_kind(uploaded_file)
    if expected is None or kind is None or kind != expected:
        raise ValidationError(UNSUPPORTED_FORMAT_MESSAGE)
    if kind in IMAGE_KINDS:
        _validate_image(uploaded_file, kind)


def _validate_image(uploaded_file, kind):
    # `except Exception` et non une liste de types : sur une entrée hostile,
    # Pillow lève bien plus que `UnidentifiedImageError`/`OSError`
    # (`SyntaxError` sur CRC PNG invalide, `DecompressionBombError`,
    # `ValueError`, `struct.error`…) — chacune donnait un 500 en B-046.
    try:
        with Image.open(uploaded_file) as image:
            width, height = image.size
            if width * height > MAX_PIXELS_BY_KIND[kind]:
                raise ValidationError(
                    f'Image trop grande ({width}×{height} px) — '
                    f'{MAX_PIXELS_BY_KIND[kind]} pixels maximum.'
                )
            # Vérifie les CRC PNG, que `load()` ne contrôle pas.
            image.verify()

        # `verify()` rend l'objet inutilisable : réouverture pour un décodage
        # COMPLET (`verify()` ne contrôle rien pour un JPEG ; le décodage
        # rejette un flux interrompu). Limite constatée : libjpeg décode
        # n'importe quel flux assez long comme du bruit — la garantie contre
        # une charge cachée est le ré-encodage systématique des images
        # (apps/evidence/tasks.py), pas cette validation. `draft` : le flux
        # JPEG est entièrement parcouru, sans allouer la pleine résolution.
        uploaded_file.seek(0)
        with Image.open(uploaded_file) as image:
            if kind == 'jpeg':
                image.draft('RGB', (1, 1))
            image.load()
    except ValidationError:
        raise
    except Exception:
        raise ValidationError(CORRUPTED_IMAGE_MESSAGE)
    finally:
        uploaded_file.seek(0)


def raise_if_upload_was_too_large(request):
    """Complète `upload_handlers.MaxSizeUploadHandler` : un fichier écarté
    pendant la réception est ABSENT de `request.FILES`, ce qui donnerait
    sinon le message trompeur « Aucun fichier n'a été soumis »."""
    if getattr(request, 'upload_too_large', False):
        raise serializers.ValidationError({'file': [UPLOAD_TOO_LARGE_MESSAGE]})
