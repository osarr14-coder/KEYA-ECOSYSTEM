import uuid

from django.conf import settings
from django.db import models

from apps.organizations.models import CountryPack


class PricingCanal(models.TextChoices):
    """Vocabulaire fixe de la doctrine produit (section 14ter du modèle
    économique) — comme `TrustLevel`/`TaskType`, jamais une configuration
    `CountryPack` : les DEUX canaux existent partout, seul leur TAUX varie
    par pays (via `PricingConfig.country_pack`).
    """

    CANAL_1_MARGE = 'canal_1_marge', 'Marge (canal 1)'
    CANAL_2_COMMISSION = 'canal_2_commission', 'Commission (canal 2)'


class PricingConfig(models.Model):
    """Taux versionné (marge ou commission) pour un `CountryPack` — ticket
    025. Un changement de taux est TOUJOURS un nouvel enregistrement,
    jamais une modification d'un enregistrement existant : aucun champ
    `is_active`, aucun champ `previous_rate`.

    Le taux ACTUEL pour un `(country_pack, canal)` donné est le DERNIER
    enregistrement (`-created_at`) — dérivé, jamais stocké séparément
    (doctrine Visible Trust, CLAUDE.md). L'« ancien taux » de tout
    changement se lit dans l'historique complet (l'enregistrement
    précédent), jamais dupliqué en champ dédié.

    Immutabilité protégée en base par RLS (voir migration
    `0002_pricingconfig_rls.py`) — policies `SELECT`/`INSERT` permissives
    (`USING (true)` / `WITH CHECK (true)`, aucune colonne
    `organization_id` naturelle : `PricingConfig` est rattaché à
    `CountryPack`, pas à une organisation), et **aucune policy
    `UPDATE`/`DELETE`** — sous `FORCE ROW LEVEL SECURITY`, ceci bloque ces
    deux commandes par défaut, même mécanisme que `procurement_devis`
    (ticket 022). Décision de conception explicite (ticket 025, point C) :
    même rigueur que l'append-only `TrustEvent`/`Devis`, pas une simple
    discipline applicative comme `CountryPack`/`Organization`/`Role` (qui
    n'ont aucune policy RLS).

    Lecture réservée à `admin_keyimmo` (ticket 025, point B) — appliquée
    par permission DRF (`IsAdminKeyimmo`), jamais par RLS : division déjà
    établie dans ce projet, RLS protège la frontière
    organisationnelle/l'immutabilité, les permissions DRF protègent le
    rôle.

    **Colonne `sequence` ajoutée au ticket B-031** — ce paragraphe affirmait
    initialement (ticket 025) qu'aucune colonne `sequence` n'était
    nécessaire, en raisonnant que `create_pricing_config` ne crée jamais
    qu'un seul enregistrement par appel, contrairement au déclencheur réel
    du bug `TrustEvent` (ticket 013 bis, deux événements créés dans la MÊME
    transaction sans commit intermédiaire). Ce raisonnement structurel
    reste correct — vérifié à nouveau au ticket B-031, `create_pricing_
    config` n'est TOUJOURS appelé qu'à un seul endroit en production — mais
    il ignorait un risque réel par un mécanisme DIFFÉRENT : rien n'empêche
    deux requêtes HTTP quasi simultanées de créer deux `PricingConfig` pour
    le même `(country_pack, canal)` avec un `created_at` trop proche pour
    être départagé de façon fiable, et `get_active_rate` (qui dérive ce tri)
    alimente directement le calcul RÉEL de marge KEYIMMO (`apps.procurement.
    services._derive_marge_estimee`, invariant 25.15). `sequence` reprend
    donc EXACTEMENT le mécanisme de `TrustEvent.sequence` (`BigIntegerField`
    unique, alimenté par `nextval()` sur une séquence Postgres dédiée,
    migration `0005_pricingconfig_sequence.py`) — ordre d'insertion strict,
    jamais recalculable après coup, departage `(-created_at, -sequence)`
    (`apps.pricing.services.LATEST_FIRST_ORDERING`) même quand deux lignes
    partagent un `created_at` identique.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    country_pack = models.ForeignKey(
        CountryPack, on_delete=models.PROTECT, related_name='pricing_configs',
    )
    canal = models.CharField(max_length=30, choices=PricingCanal.choices)
    rate = models.DecimalField(max_digits=5, decimal_places=2)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='pricing_configs_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    sequence = models.BigIntegerField(unique=True, editable=False)

    class Meta:
        db_table = 'pricing_pricingconfig'

    def save(self, *args, **kwargs):
        if self.sequence is None:
            # `nextval()` explicite plutôt que de compter sur le DEFAULT
            # côté DB (migration 0005) — même raison que `TrustEvent.save()`
            # (ticket 013 bis) : `sequence` n'est pas un `AutoField`, Django
            # envoie donc TOUJOURS une valeur explicite pour ce champ à
            # l'INSERT ; ne pas la poser ici enverrait NULL et écraserait
            # silencieusement le DEFAULT côté DB.
            from django.db import connection

            with connection.cursor() as cursor:
                cursor.execute("SELECT nextval('pricing_pricingconfig_sequence_seq')")
                self.sequence = cursor.fetchone()[0]
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.country_pack.code} — {self.get_canal_display()} : {self.rate}%'


class LegalPaymentTierTemplate(models.Model):
    """Structure versionnée de paliers légaux de paiement pour un
    `CountryPack` — ticket B-027 (section 5 du modèle économique,
    `docs/economie/KEYIMMO_Modele_Economique_Consolide.md`). Même pattern
    structurel que `MilestoneTemplate` (ticket 002, `apps/programs/models.py`)
    — parent versionné + enfants ordonnés (`LegalPaymentTierStep`) — mais
    JAMAIS couplé par FK à `MilestoneTemplate` (décision de conception C) :
    les deux structures évoluent indépendamment, un pays peut faire changer
    sa loi de paiement sans toucher sa séquence de jalons de construction.

    `created_by`/`created_at` (rédaction du brouillon) sont des champs
    SÉPARÉS de `activated_by`/`activated_at` (l'activation — décision D) :
    le modèle économique distingue explicitement « validé JURIDIQUEMENT »
    (hors plateforme, par un avocat) et « activé EXPLICITEMENT » (sur la
    plateforme, par `admin_keyimmo`) — deux événements, jamais confondus.
    `activated_by`/`activated_at` restent `NULL` tant que ce template est un
    BROUILLON, et surtout : une fois posés, ne sont PLUS JAMAIS réécrits,
    même si ce template est supplanté par une activation plus récente — la
    preuve « ce template a été activé par X le Y » reste vraie pour
    toujours, quel que soit son statut d'actif COURANT (voir
    `ActiveLegalPaymentTierTemplate` ci-dessous pour cette notion séparée).

    Aucun champ `is_active` (contrairement à `MilestoneTemplate`) : le
    template actuellement actif se lit dans `ActiveLegalPaymentTierTemplate`,
    jamais dérivé d'un tri sur `activated_at` ici.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    country_pack = models.ForeignKey(
        CountryPack, on_delete=models.PROTECT, related_name='legal_payment_tier_templates',
    )
    version = models.PositiveIntegerField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name='legal_payment_tier_templates_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    activated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name='legal_payment_tier_templates_activated',
    )
    activated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'pricing_legal_payment_tier_template'
        constraints = [
            models.UniqueConstraint(
                fields=['country_pack', 'version'], name='unique_tier_template_version_per_country_pack',
            ),
        ]

    def __str__(self):
        return f'{self.country_pack.code} — paliers v{self.version}'


class LegalPaymentTierStep(models.Model):
    """Un palier légal ordonné d'un `LegalPaymentTierTemplate` — même
    pattern que `MilestoneTemplateStep` (ticket 002).

    `cumulative_cap_percent` est un plafond CUMULÉ (décision A) — ex.
    Sénégal : 35, 70, 95, 100 pour le dernier palier, jamais un incrément
    (35, 35, 25, 5). `allows_progressive_payments` est porté PAR PALIER
    (décision B), pas par le template : un même régime légal peut autoriser
    des versements progressifs sur certains paliers et exiger un versement
    unique sur d'autres.

    `code` est un `CharField` LIBRE (décision C), comme
    `MilestoneTemplateStep.code` — AUCUNE FK vers `MilestoneTemplateStep`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(
        LegalPaymentTierTemplate, on_delete=models.CASCADE, related_name='steps',
    )
    order = models.PositiveIntegerField()
    code = models.CharField(max_length=50)
    label = models.CharField(max_length=100)
    cumulative_cap_percent = models.DecimalField(max_digits=5, decimal_places=2)
    allows_progressive_payments = models.BooleanField()

    class Meta:
        db_table = 'pricing_legal_payment_tier_step'
        ordering = ['order']
        constraints = [
            models.UniqueConstraint(
                fields=['template', 'order'], name='unique_tier_step_order_per_template',
            ),
            models.UniqueConstraint(
                fields=['template', 'code'], name='unique_tier_step_code_per_template',
            ),
        ]

    def __str__(self):
        return f'{self.template} — {self.order}. {self.label} ({self.cumulative_cap_percent}%)'


class ActiveLegalPaymentTierTemplate(models.Model):
    """Pointeur MUTABLE vers le `LegalPaymentTierTemplate` actuellement
    actif d'un `country_pack` — ticket B-027, décision D-bis.

    Distinct à dessein de `LegalPaymentTierTemplate.activated_at` (un fait
    historique permanent, jamais réécrit) : ce modèle-ci ne porte AUCUN
    historique, seulement l'état COURANT — sa mise à jour est un vrai
    `UPDATE`, assumé, pas une violation de la doctrine append-only (qui ne
    s'applique qu'aux enregistrements qui AFFIRMENT un fait dans le temps,
    pas à un pointeur d'état courant — même distinction que `Task.status`,
    exception documentée à cette doctrine, ticket 006).

    `country_pack` en `OneToOneField` : Django pose une contrainte `UNIQUE`
    réelle en base sur ce champ — c'est CETTE contrainte, pas une
    vérification applicative, qui garantit « au plus un actif par
    country_pack », même sous accès concurrent (voir
    `apps.pricing.services._upsert_active_pointer`, qui reprend la
    discipline anti-race EXPLICITE de `apps.tasks.services.
    _get_or_create_task`, ticket 017 : `get()`, tentative de `create()`,
    rattrapage explicite d'`IntegrityError`, second `get()` — jamais un
    `get_or_create()`/`update_or_create()` nu).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    country_pack = models.OneToOneField(
        CountryPack, on_delete=models.PROTECT, related_name='active_legal_payment_tier_template',
    )
    template = models.ForeignKey(
        LegalPaymentTierTemplate, on_delete=models.PROTECT, related_name='active_pointers',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'pricing_active_legal_payment_tier_template'

    def __str__(self):
        return f'{self.country_pack.code} → {self.template}'
