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


class TrustEventIsImmutable(Exception):
    """Levée par toute tentative de modifier/supprimer un TrustEvent en
    Python — que ce soit via `instance.save()`/`instance.delete()` sur une
    ligne existante, ou via `TrustEvent.objects.filter(...).update()/.delete()`
    en contournant `apps.trust.repository`.

    Sans cette garde, ces contournements échoueraient silencieusement (RLS
    n'a aucune policy UPDATE/DELETE sur `trust_event`, donc l'opération
    affecte 0 ligne sans lever d'erreur — voir CLAUDE.md, section
    "Append-only"). Cette exception rend l'échec visible immédiatement en
    Python, avant même d'atteindre la DB, en plus du trigger qui protège au
    niveau DB (migration 0002) si jamais ce garde-fou Python était lui-même
    contourné (ex : SQL brut).
    """


class TrustEventQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise TrustEventIsImmutable(
            'TrustEvent.objects.update() est interdit : trust_event est append-only. '
            'Créez un nouvel événement via apps.trust.repository.create(..., previous_event=...).',
        )

    def delete(self):
        raise TrustEventIsImmutable(
            'TrustEvent.objects.delete() est interdit : trust_event est append-only.',
        )


class TrustEventManager(models.Manager.from_queryset(TrustEventQuerySet)):
    pass


class TrustEvent(models.Model):
    """Append-only strict — voir `apps/trust/repository.py` (aucune méthode
    update/delete exposée), la garde Python ci-dessus (`save`/`delete`
    surchargés, `TrustEventQuerySet`) et la migration `0002_append_only`
    (trigger Postgres qui rejette tout UPDATE/DELETE au niveau DB, y compris
    pour le rôle propriétaire de la table). Trois couches indépendantes :
    contourner l'une ne contourne pas les autres.

    Le statut affiché d'un objet métier (Milestone, WorkDeclaration,
    Evidence, Reserve...) est TOUJOURS dérivé du dernier TrustEvent via
    `repository.get_current_status()`, jamais stocké comme colonne à part
    sur l'objet lui-même — voir doctrine Visible Trust dans CLAUDE.md.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        # PROTECT et non CASCADE : un TrustEvent ne doit jamais disparaître
        # comme simple effet de bord de la suppression d'une autre ligne —
        # une purge de données historiques, si un jour nécessaire, doit être
        # un choix explicite et tracé, pas une cascade silencieuse. Cohérent
        # avec `actor`/`subject_type`/`previous_event`, déjà en PROTECT.
        Organization, on_delete=models.PROTECT, related_name='trust_events',
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

    objects = TrustEventManager()

    class Meta:
        db_table = 'trust_event'
        indexes = [
            models.Index(fields=['subject_type', 'subject_id']),
        ]

    def __str__(self):
        return f'{self.get_level_display()} — {self.subject_type} {self.subject_id}'

    def save(self, *args, **kwargs):
        if self.pk and TrustEvent.objects.filter(pk=self.pk).exists():
            raise TrustEventIsImmutable(
                'TrustEvent.save() sur une ligne existante est interdit : trust_event est '
                'append-only. Créez un nouvel événement via '
                'apps.trust.repository.create(..., previous_event=...).',
            )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TrustEventIsImmutable(
            'TrustEvent.delete() est interdit : trust_event est append-only.',
        )
