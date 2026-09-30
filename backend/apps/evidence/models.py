import uuid

from django.conf import settings
from django.db import models

from apps.organizations.models import Organization
from apps.programs.models import Milestone


class SensitivityLevel(models.TextChoices):
    """Classification de sécurité d'un `Document`. Vocabulaire fixe du
    produit (comme `TrustLevel`, ticket 003) — pas une donnée qui varie par
    CountryPack, donc un `TextChoices` est approprié ici (voir CLAUDE.md).

    Ordonné du moins au plus sensible : PUBLIC < INTERNE < CONFIDENTIEL.
    """

    PUBLIC = 'public', 'Public'
    INTERNE = 'interne', 'Interne'
    CONFIDENTIEL = 'confidentiel', 'Confidentiel'


class AntivirusStatus(models.TextChoices):
    """PO-2026-09-29-13 et PO-2026-09-30-07 (T15) — ce que l'antivirus a dit
    du fichier stocké. `non_analyse` : accepté sans moteur (dispositif
    compensatoire de la DÉMO) ou déposé avant l'analyse des dépôts ; repassé
    au moteur par `manage.py rescan_unscanned_documents`. `infecte` : détecté
    à cette nouvelle analyse — le fichier n'est plus servi."""

    ANALYSE = 'analyse', 'Analysé'
    NON_ANALYSE = 'non_analyse', 'Non analysé'
    INFECTE = 'infecte', 'Détecté — non servi'


class DocumentVisibility(models.TextChoices):
    """Audience visée pour un document — distincte de `sensitivity_level`
    (qui conditionne l'accès technique) : c'est une intention d'usage
    (ex : partager avec le client), pas un mécanisme de sécurité.
    """

    INTERNE = 'interne', 'Interne'
    CLIENT = 'client', 'Client'
    PUBLIC = 'public', 'Public'


def _document_upload_path(instance, filename):
    # Chemin non prévisible à partir du nom de fichier original — l'accès
    # n'en dépend de toute façon jamais (voir apps/evidence/views.py, seule
    # porte d'entrée : URL signée + permission revérifiée), mais autant ne
    # pas exposer inutilement une arborescence par organisation lisible.
    extension = filename.rsplit('.', 1)[-1] if '.' in filename else ''
    suffix = f'.{extension}' if extension else ''
    return f'documents/{instance.id}{suffix}'


def _thumbnail_upload_path(instance, filename):
    return f'documents/{instance.id}_thumb.jpg'


class Document(models.Model):
    """GED minimale (ticket 004). L'accès au fichier ne passe JAMAIS par
    `file.url` directement dans une réponse API ou un template — voir
    `apps/evidence/views.py` pour l'unique chemin d'accès autorisé (URL
    signée à durée limitée + permission revérifiée au moment du
    téléchargement, quel que soit `sensitivity_level`).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='documents',
    )

    category = models.CharField(max_length=100)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='documents',
    )
    visibility = models.CharField(
        max_length=20, choices=DocumentVisibility.choices, default=DocumentVisibility.INTERNE,
    )
    sensitivity_level = models.CharField(
        max_length=20, choices=SensitivityLevel.choices, default=SensitivityLevel.INTERNE,
    )
    hash = models.CharField(max_length=64, editable=False)  # sha256 hex du fichier tel qu'uploadé
    version = models.PositiveIntegerField(default=1)

    # Doublon exact (même hash) détecté dans l'organisation à la création
    # (ticket B-040) — pointe toujours vers le plus ancien Document portant
    # ce hash, jamais vers un doublon intermédiaire. Champ de provenance au
    # même titre que `hash`/`source`/`captured_at` : calculé une seule fois
    # à la création, jamais recalculé ensuite.
    duplicate_of = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True,
        editable=False, related_name='duplicates',
    )

    file = models.FileField(upload_to=_document_upload_path)
    thumbnail = models.FileField(upload_to=_thumbnail_upload_path, null=True, blank=True)

    # Provenance — critère d'acceptation ticket 004 : doit survivre intacte
    # au traitement asynchrone (compression/miniature, voir
    # apps/evidence/tasks.py, qui n'écrit jamais ces champs).
    source = models.CharField(max_length=100)
    captured_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Défaut prudent : un document dont l'analyse n'est pas attestée est
    # « non analysé » (y compris ceux déposés avant PO-2026-09-29-13).
    antivirus_status = models.CharField(
        max_length=20, choices=AntivirusStatus.choices, default=AntivirusStatus.NON_ANALYSE,
    )

    class Meta:
        db_table = 'evidence_document'

    def __str__(self):
        return f'{self.category} ({self.id})'


class WorkDeclaration(models.Model):
    """Un constructeur déclare un travail terminé sur un jalon. La création
    génère un `TrustEvent` (niveau déclaré) dont le sujet est cette
    déclaration elle-même — voir apps/evidence/services.py.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='work_declarations',
    )
    milestone = models.ForeignKey(
        Milestone, on_delete=models.PROTECT, related_name='work_declarations',
    )
    declared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='work_declarations',
    )
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'evidence_work_declaration'

    def __str__(self):
        return f'Déclaration — {self.milestone} ({self.created_at:%Y-%m-%d})'


class Evidence(models.Model):
    """Une preuve rattachée à une déclaration de travaux, référençant un ou
    plusieurs `Document`. Un `Document` ne sait pas qu'il est une preuve —
    seule `Evidence` porte cette relation (voir ticket 004, scope).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='evidences',
    )
    work_declaration = models.ForeignKey(
        WorkDeclaration, on_delete=models.PROTECT, related_name='evidences',
    )
    documents = models.ManyToManyField(Document, related_name='evidences')
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='evidences',
    )
    # PO-2026-09-28-63 — code de la pièce exigée du jalon à laquelle répond
    # ce dépôt (`Milestone.required_pieces`), vide pour « Autre pièce ». Dit
    # la PRÉSENCE d'une pièce, jamais sa conformité (CDC §9.3).
    required_piece = models.CharField(max_length=50, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'evidence_evidence'

    def __str__(self):
        return f'Preuve — {self.work_declaration} ({self.created_at:%Y-%m-%d})'
