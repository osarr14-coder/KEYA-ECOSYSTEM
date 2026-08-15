import uuid

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from apps.organizations.models import Organization


class TrustLevel(models.TextChoices):
    """Les 5 niveaux de la doctrine Visible Trust.

    Contrairement à `MilestoneTemplate` (ticket 002), ceci n'est PAS une
    configuration qui varie par pays/organisation — c'est le vocabulaire fixe
    de la doctrine produit elle-même, cité nommément dans le ticket. Coder ce
    vocabulaire en `TextChoices` n'est donc pas le genre de "en dur" que
    CLAUDE.md interdit (ça concerne les données qui varient par CountryPack).
    """

    DECLARE = 'declare', 'Déclaré'
    DOCUMENTE = 'documente', 'Documenté'
    CONTROLE = 'controle', 'Contrôlé'
    VERIFIE = 'verifie', 'Vérifié'
    VALIDE = 'valide', 'Validé'


class TrustEvent(models.Model):
    """Append-only strict — voir `apps/trust/repository.py` (aucune méthode
    update/delete exposée) et la migration `0002_append_only` (trigger
    Postgres qui rejette tout UPDATE/DELETE au niveau DB, y compris pour le
    rôle propriétaire de la table).

    Le statut affiché d'un objet métier (Milestone, WorkDeclaration,
    Evidence, Reserve...) est TOUJOURS dérivé du dernier TrustEvent via
    `repository.get_current_status()`, jamais stocké comme colonne à part
    sur l'objet lui-même — voir doctrine Visible Trust dans CLAUDE.md.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='trust_events',
    )

    # Référence polymorphe vers l'objet concerné (Milestone aujourd'hui ;
    # WorkDeclaration, Evidence, Reserve dans des tickets ultérieurs). Tous
    # les modèles du projet utilisent une clé primaire UUID, donc un
    # UUIDField générique suffit pour subject_id quel que soit le type.
    subject_type = models.ForeignKey(ContentType, on_delete=models.PROTECT)
    subject_id = models.UUIDField()
    subject = GenericForeignKey('subject_type', 'subject_id')

    level = models.CharField(max_length=20, choices=TrustLevel.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='trust_events',
    )
    source = models.CharField(max_length=100)
    scope = models.CharField(max_length=100, blank=True)

    # Chaîne une correction à l'événement qu'elle corrige. L'événement
    # original n'est jamais modifié ni supprimé — la correction est un
    # nouvel événement, plus récent, qui devient le nouveau statut courant.
    previous_event = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.PROTECT, related_name='corrections',
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'trust_event'
        indexes = [
            models.Index(fields=['subject_type', 'subject_id']),
        ]

    def __str__(self):
        return f'{self.get_level_display()} — {self.subject_type} {self.subject_id}'
