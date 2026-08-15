import uuid

from django.db import models

from apps.organizations.models import CountryPack, Organization


class Program(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='programs',
    )
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'programs_program'

    def __str__(self):
        return self.name


class Asset(models.Model):
    """Un bien immobilier. `organization` est dénormalisé depuis `program`
    (posé automatiquement à la création, jamais saisi par le client) — c'est
    ce qui permet une policy RLS simple par colonne, sans jointure, suivant
    le pattern établi au ticket 001.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='assets',
    )
    program = models.ForeignKey(Program, on_delete=models.CASCADE, related_name='assets')
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'programs_asset'

    def __str__(self):
        return self.name


class Lot(models.Model):
    """Appartient toujours à un seul `Asset` (et donc, transitivement, à un
    seul `Program`) — critère d'acceptation du ticket 002.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='lots',
    )
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name='lots')
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'programs_lot'

    def __str__(self):
        return self.name


class MilestoneTemplate(models.Model):
    """Structure versionnée de jalons pour un `CountryPack`. Le contenu
    (liste ordonnée de `MilestoneTemplateStep`) est une donnée pure — aucun
    nom de jalon ne doit apparaître ailleurs que dans une ligne de cette
    table ou d'une migration de seed (critère d'acceptation ticket 002).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    country_pack = models.ForeignKey(
        CountryPack, on_delete=models.PROTECT, related_name='milestone_templates',
    )
    version = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'programs_milestone_template'
        constraints = [
            models.UniqueConstraint(
                fields=['country_pack', 'version'], name='unique_template_version_per_country_pack',
            ),
        ]

    def __str__(self):
        return f'{self.country_pack.code} v{self.version}'


class MilestoneTemplateStep(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(
        MilestoneTemplate, on_delete=models.CASCADE, related_name='steps',
    )
    order = models.PositiveIntegerField()
    code = models.CharField(max_length=50)
    label = models.CharField(max_length=100)
    # Pondération financière (13.3) : champ prévu dans le schéma, aucune
    # logique de calcul ne l'utilise à ce stade — explicitement hors scope
    # du ticket 002.
    weight = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = 'programs_milestone_template_step'
        ordering = ['order']
        constraints = [
            models.UniqueConstraint(
                fields=['template', 'order'], name='unique_step_order_per_template',
            ),
            models.UniqueConstraint(
                fields=['template', 'code'], name='unique_step_code_per_template',
            ),
        ]

    def __str__(self):
        return f'{self.template} — {self.order}. {self.label}'


class Milestone(models.Model):
    """Instance concrète, propre à un `Lot`, créée par recopie des
    `MilestoneTemplateStep` du template actif au moment de la création du
    lot — un instantané, pas une référence vivante au template (modifier le
    template plus tard ne doit pas changer les jalons déjà créés, seulement
    ceux des lots créés après la modification).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='milestones',
    )
    lot = models.ForeignKey(Lot, on_delete=models.CASCADE, related_name='milestones')
    order = models.PositiveIntegerField()
    code = models.CharField(max_length=50)
    label = models.CharField(max_length=100)
    weight = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'programs_milestone'
        ordering = ['order']
        constraints = [
            models.UniqueConstraint(
                fields=['lot', 'order'], name='unique_milestone_order_per_lot',
            ),
        ]

    def __str__(self):
        return f'{self.lot} — {self.order}. {self.label}'
