import uuid

from django.conf import settings
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
    # Ajouté au ticket 008 (HOME client) : le hero du bien affiche une
    # localisation, absente du schéma du ticket 002 qui n'en avait pas besoin.
    # Texte libre pour le MVP, jamais affiché sans passer par un endpoint —
    # voir apps/home/services.py.
    location = models.CharField(max_length=255, blank=True)
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
    # Ajouté au ticket 009 (BUILD Control Tower), sur demande explicite de
    # l'utilisateur : POINT D'ANCRAGE MINIMAL pour un futur module PRO
    # (Professional Capability Passport, complément V4.0 §6.2), PAS son
    # implémentation complète — aucun flux de candidature/opportunité ici,
    # juste ce champ + un endpoint qui le pose. Un futur ticket PRO doit
    # ÉTENDRE ce champ, pas le redéfinir ni en créer un second. Distinct de
    # `organization` (l'organisation du programme/sponsor, qui scope la RLS
    # de toute la hiérarchie) : `assigned_organization` est l'entreprise
    # constructrice responsable de l'EXÉCUTION de ce lot — peut rester
    # identique à `organization` (auto-exécution, seul cas déjà couvert par
    # les fixtures de tickets précédents) ou, à terme, une organisation
    # tierce. `null=True` : « capacité manquante » (ticket 009, vue
    # Exceptions) = aucune organisation constructrice affectée.
    assigned_organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='assigned_lots',
        null=True, blank=True,
    )
    # Ajouté au ticket B-033 : prérequis de la méthode de répartition
    # `prorata_surface` de `ProgramCost` (foncier/BE répartis
    # proportionnellement à la surface de chaque lot). `null=True` —
    # AUCUNE valeur par défaut inventée pour les lots déjà existants
    # (discipline déjà assumée dans ce projet, ex. `Lot.assigned_organization`
    # ticket 009). `apps.programs.services.compute_lot_repartition` refuse
    # explicitement `prorata_surface` si un seul lot du programme n'a pas
    # cette valeur — jamais un partage silencieux à zéro. Unité m² implicite,
    # comme le reste du projet n'a jamais eu besoin d'unité explicite.
    surface = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
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


class LotClient(models.Model):
    """Rattache un utilisateur (rôle `client`) au(x) `Lot` qu'il a acquis —
    ajouté au ticket 008 (HOME client) : sans cette table, rien ne permet de
    savoir quel `Lot` appartient à quel client, alors que c'est exactement la
    donnée qui fonde le critère de sécurité central du ticket (« le client ne
    voit aucune donnée d'un autre lot que le ou les siens »). `organization`
    dénormalisé depuis `lot.organization`, même pattern RLS que le reste de
    cette app.

    Aucun endpoint d'écriture n'existe pour ce ticket (explicitement lecture
    seule, voir 008-home-client-lecture-seule.md) — une assignation se crée
    pour l'instant par l'ORM (fixture, shell), pas par l'API. Une UI/API
    d'assignation viendrait d'un futur ticket, hors scope ici.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='lot_clients',
    )
    lot = models.ForeignKey(Lot, on_delete=models.CASCADE, related_name='client_assignments')
    client = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='client_lots',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'programs_lot_client'
        constraints = [
            models.UniqueConstraint(fields=['lot', 'client'], name='unique_client_per_lot'),
        ]

    def __str__(self):
        return f'{self.client.email} — {self.lot}'


class ProgramCostRepartitionMethod(models.TextChoices):
    """Vocabulaire fixe (comme `PricingCanal`/`TrustLevel`) — les deux
    méthodes existent partout, seul le CHOIX par programme varie (posé sur
    chaque révision `ProgramCost`, pas codé en dur dans le calcul).
    """

    PRORATA_SURFACE = 'prorata_surface', 'Prorata surface'
    PARTS_EGALES = 'parts_egales', 'Parts égales'


class ProgramCost(models.Model):
    """Coûts foncier + bureau d'études (BE) engagés au niveau du PROGRAMME
    entier (canal 1) — ticket B-033. Append-only, même doctrine que
    `PricingConfig`/`LegalPaymentTierTemplate` : un changement de coût est
    TOUJOURS un nouvel enregistrement, jamais une modification d'un
    enregistrement existant — aucun champ `is_active`.

    **`be_total` (bureau d'études) est DISTINCT du bureau de contrôle (BC)**
    — invariant 25.16 (CLAUDE.md, budget BC sanctuarisé) ne concerne PAS ce
    champ, deux acteurs différents du modèle économique (section 6,
    `docs/economie/KEYIMMO_Modele_Economique_Consolide.md`).

    Le coût COURANT d'un programme est le DERNIER `ProgramCost` créé
    (`LATEST_FIRST_ORDERING`) — dérivé, jamais stocké séparément, doctrine
    Visible Trust appliquée à une configuration économique (même principe
    que `PricingConfig`, ticket 025).

    `organization` dénormalisé depuis `program.organization` (même pattern
    que `Asset.organization`) — permet une policy RLS simple par colonne.
    Immutabilité protégée par RLS (voir migration
    `0006_programcost_rls.py`) : `SELECT`/`INSERT` scopés organisation,
    **aucune policy `UPDATE`/`DELETE`** — même niveau que `Devis`
    (ticket 022), pas les trois couches de `TrustEvent` (pas de trigger
    append-only ici).

    `justification` est OBLIGATOIRE (`TextField`, pas `blank=True`) —
    contrairement à `Inspection.note`/`Evidence.note` (tous deux
    optionnels) : chaque révision d'un coût programme doit s'expliquer,
    aucune exception.

    `sequence` — même mécanisme que `TrustEvent.sequence`/
    `PricingConfig.sequence` (`BigIntegerField` unique, `nextval()` sur une
    séquence Postgres dédiée), construit dès la conception de ce modèle,
    PAS un retrofit après un flake comme `PricingConfig` a dû le faire au
    ticket B-031 : `-created_at` seul est ambigu entre deux révisions
    créées à quelques millisecondes d'écart (deux requêtes HTTP quasi
    simultanées) — la leçon du ticket B-031 est appliquée directement ici.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='program_costs',
    )
    program = models.ForeignKey(Program, on_delete=models.PROTECT, related_name='costs')
    foncier_total = models.DecimalField(max_digits=16, decimal_places=2)
    be_total = models.DecimalField(max_digits=16, decimal_places=2)
    repartition_method = models.CharField(max_length=30, choices=ProgramCostRepartitionMethod.choices)
    justification = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='program_costs_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    sequence = models.BigIntegerField(unique=True, editable=False)

    class Meta:
        db_table = 'programs_program_cost'

    def save(self, *args, **kwargs):
        if self.sequence is None:
            # `nextval()` explicite plutôt que de compter sur le DEFAULT
            # côté DB — même raison que `TrustEvent.save()`/
            # `PricingConfig.save()` : `sequence` n'est pas un `AutoField`
            # (impossible avec la pk UUID de ce modèle), Django envoie donc
            # TOUJOURS une valeur explicite pour ce champ à l'INSERT ; ne
            # pas la poser ici enverrait NULL et écraserait silencieusement
            # le DEFAULT côté DB.
            from django.db import connection

            with connection.cursor() as cursor:
                cursor.execute("SELECT nextval('programs_program_cost_sequence_seq')")
                self.sequence = cursor.fetchone()[0]
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.program} — foncier {self.foncier_total} / BE {self.be_total}'
