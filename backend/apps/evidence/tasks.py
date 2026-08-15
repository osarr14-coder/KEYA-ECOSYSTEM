import io

from celery import shared_task
from django.core.exceptions import ObjectDoesNotExist
from django.core.files.base import ContentFile
from django.db import transaction
from PIL import Image, UnidentifiedImageError

from apps.core.rls import set_rls_context

MAX_DIMENSION_PX = 1920
THUMBNAIL_MAX_DIMENSION_PX = 320
JPEG_QUALITY = 80

# Nombre de tentatives avant échec définitif, et délai (secondes) entre
# elles. Un vrai worker distant peut légitimement tenter une lecture avant
# que la transaction qui a créé le Document n'ait fini de committer côté
# connexion du worker (course bénigne, RLS renvoie alors "introuvable") —
# ça justifie quelques tentatives rapprochées, jamais une attente
# indéfinie : un document réellement inexistant doit finir par échouer pour
# de bon. Voir apps/evidence/tests_celery_integration.py (ADR 0001) pour la
# preuve contre un vrai worker — retry ET échec définitif.
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 1


@shared_task(
    bind=True,
    autoretry_for=(ObjectDoesNotExist,),
    retry_backoff=RETRY_BACKOFF_SECONDS,
    retry_backoff_max=RETRY_BACKOFF_SECONDS * 4,
    retry_jitter=False,
    max_retries=MAX_RETRIES,
)
def process_document_media(self, document_id, organization_id, requested_by_user_id=None):
    """Compresse l'image et génère une miniature, en tâche asynchrone
    (Celery + broker Redis réel — voir docs/adr/0001-celery-eager-mode.md).

    Un worker Celery réel n'a, par construction, AUCUNE requête HTTP pour
    poser le contexte RLS (organisation active) — contrairement au mode
    eager (utilisé par la majorité des tests, voir config/settings_test.py),
    où la tâche hérite du contexte déjà posé par
    `apps.core.middleware.OrganizationScopeMiddleware` pour la requête en
    cours, dans le même process. `organization_id` (et `requested_by_user_id`
    si connu — nécessaire pour d'éventuelles futures écritures nécessitant la
    branche "ma propre ligne" d'une policy RLS, voir Membership au ticket
    001) doivent donc être transmis explicitement en argument de la tâche
    par l'appelant (`apps.evidence.services.create_document`) et posés ICI,
    au tout début de l'exécution, avant toute lecture/écriture.

    Ne touche JAMAIS aux champs de provenance (`source`, `captured_at`,
    `owner`, `created_at`) ni à `hash` — `hash` reste celui du fichier tel
    qu'uploadé, avant traitement, comme ancrage de chaîne de custody
    (critère d'acceptation ticket 004).

    Tout le corps tourne dans un seul `transaction.atomic()` : `set_rls_context`
    pose la session var via `SET LOCAL`, qui n'a d'effet que pour la
    transaction en cours (voir apps/core/rls.py) — un worker Celery tourne en
    autocommit par défaut, sans transaction englobante automatique
    (contrairement à une requête HTTP, enveloppée par
    `apps.core.middleware.OrganizationScopeMiddleware`). Sans ce bloc
    explicite, le contexte RLS retombe avant même la première requête
    suivante — bug réel rencontré en écrivant les tests d'intégration contre
    un vrai worker (docs/adr/0001-celery-eager-mode.md).
    """
    from .models import Document  # import différé : évite un cycle au chargement des tasks Celery

    with transaction.atomic():
        set_rls_context(organization_id=organization_id, user_id=requested_by_user_id)

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
