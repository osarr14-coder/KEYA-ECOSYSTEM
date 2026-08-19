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

    Pas de colonne `sequence` (contrairement à `TrustEvent`, ticket 013
    bis) : le piège de tie-break de `TrustEvent` vient de DEUX événements
    créés dans la MÊME transaction sans commit intermédiaire
    (`_advance_existing_reserve`). Rien d'équivalent ici —
    `apps.pricing.services.create_pricing_config` ne crée jamais qu'UN
    SEUL enregistrement par appel : `-created_at` seul suffit à dériver le
    dernier taux sans ambiguïté.
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

    class Meta:
        db_table = 'pricing_pricingconfig'

    def __str__(self):
        return f'{self.country_pack.code} — {self.get_canal_display()} : {self.rate}%'
