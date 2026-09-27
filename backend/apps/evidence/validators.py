"""Ticket B-046 (Phase 1, `docs/audit-cdc-v3-mvp-ecart-vefa.md`, CDC §10) —
validation d'upload jamais faite avant ce ticket (confirmé : `Document.file`
et `DocumentUploadSerializer.file` n'avaient aucun validateur). Vérifie le
CONTENU réel du fichier, jamais le `Content-Type` déclaré par le client
(en-tête HTTP arbitraire, trivialement falsifiable) : magic bytes `%PDF-`
pour un PDF, décodage Pillow réel (déjà une dépendance du projet, voir
apps/evidence/tasks.py) pour une image JPEG/PNG.
"""

from django.core.exceptions import ValidationError
from PIL import Image, UnidentifiedImageError

MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 Mo, CDC §10

PDF_MAGIC_BYTES = b'%PDF-'


def validate_document_file(uploaded_file):
    """Lève `ValidationError` si le fichier dépasse la taille autorisée ou
    si son contenu réel ne correspond à aucun des formats acceptés
    (PDF, JPEG, PNG) — jamais basé sur l'extension du nom de fichier ni sur
    `uploaded_file.content_type` (déclaratif, non fiable).
    """
    if uploaded_file.size > MAX_UPLOAD_SIZE_BYTES:
        raise ValidationError(
            f'Fichier trop volumineux ({uploaded_file.size} octets) — '
            f'{MAX_UPLOAD_SIZE_BYTES} octets maximum.'
        )

    uploaded_file.seek(0)
    header = uploaded_file.read(len(PDF_MAGIC_BYTES))
    uploaded_file.seek(0)
    if header == PDF_MAGIC_BYTES:
        return

    try:
        image = Image.open(uploaded_file)
        image.verify()
    except (UnidentifiedImageError, OSError):
        raise ValidationError(
            'Format de fichier non supporté — seuls PDF, JPEG et PNG sont acceptés '
            '(vérifié par le contenu réel, pas par le nom ou le type déclaré).'
        )
    finally:
        uploaded_file.seek(0)

    if image.format not in ('JPEG', 'PNG'):
        raise ValidationError(
            f'Format d\'image non supporté ({image.format}) — seuls JPEG et PNG '
            'sont acceptés parmi les images.'
        )
