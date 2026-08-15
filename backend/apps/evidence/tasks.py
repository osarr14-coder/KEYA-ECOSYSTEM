import io

from celery import shared_task
from django.core.files.base import ContentFile
from PIL import Image, UnidentifiedImageError

MAX_DIMENSION_PX = 1920
THUMBNAIL_MAX_DIMENSION_PX = 320
JPEG_QUALITY = 80


@shared_task
def process_document_media(document_id):
    """Compresse l'image et génère une miniature, en tâche asynchrone
    (Celery — voir config/settings.py pour le mode eager tant qu'aucun
    broker n'est provisionné).

    Ne touche JAMAIS aux champs de provenance (`source`, `captured_at`,
    `owner`, `created_at`) ni à `hash` — `hash` reste celui du fichier tel
    qu'uploadé, avant traitement, comme ancrage de chaîne de custody
    (critère d'acceptation ticket 004).

    Limite connue : en mode eager (actuel), cette tâche s'exécute dans la
    même transaction/connexion que la requête qui l'a déclenchée, donc le
    contexte RLS (organisation active) déjà posé par le middleware suffit.
    Le jour où un vrai worker Celery distant sera branché, il n'aura par
    définition aucune requête HTTP pour poser ce contexte — il faudra alors
    lui donner un moyen explicite de résoudre l'organisation du document
    avant de lire/écrire la ligne (hors scope du ticket 004).
    """
    from .models import Document  # import différé : évite un cycle au chargement des tasks Celery

    document = Document.objects.get(id=document_id)

    document.file.open('rb')
    try:
        image = Image.open(document.file)
        image.load()
    except (UnidentifiedImageError, OSError):
        return  # pas une image (ex : PDF) — rien à compresser/miniaturiser
    finally:
        document.file.close()

    image = image.convert('RGB')

    compressed_name = document.file.name.rsplit('/', 1)[-1]
    document.file.save(
        compressed_name, ContentFile(_resize_and_encode(image, MAX_DIMENSION_PX)), save=False,
    )
    document.thumbnail.save(
        f'{document.id}_thumb.jpg',
        ContentFile(_resize_and_encode(image, THUMBNAIL_MAX_DIMENSION_PX)),
        save=False,
    )

    document.save(update_fields=['file', 'thumbnail'])


def _resize_and_encode(image, max_dimension):
    resized = image.copy()
    resized.thumbnail((max_dimension, max_dimension))
    buffer = io.BytesIO()
    resized.save(buffer, format='JPEG', quality=JPEG_QUALITY)
    return buffer.getvalue()
