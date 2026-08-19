from django.db import migrations

# `pricing_legal_payment_tier_step` — ticket B-027. Même verrou
# d'immutabilité que `pricing_pricingconfig` (migration
# `0002_pricingconfig_rls.py`, ticket 025) : un palier n'est JAMAIS modifié
# en place — un changement de régime légal crée une NOUVELLE version de
# `LegalPaymentTierTemplate` avec de NOUVEAUX paliers, jamais une
# réécriture des paliers d'une version existante. Policies `SELECT`/
# `INSERT` permissives (`USING (true)` / `WITH CHECK (true)`) : aucune
# colonne `organization_id` sur cette table (rattachée à un
# `LegalPaymentTierTemplate`, lui-même rattaché à un `CountryPack`, jamais
# à une organisation) — rien à faire respecter comme frontière
# organisationnelle ici, seule l'immutabilité compte. Restriction de
# LECTURE à `admin_keyimmo` : permission DRF (`IsAdminKeyimmo`), jamais une
# policy RLS — même division que `PricingConfig`.
#
# **Délibérément PAS appliqué à `pricing_legal_payment_tier_template` ni à
# `pricing_active_legal_payment_tier_template`** — contrairement à
# `PricingConfig`, `LegalPaymentTierTemplate` a un besoin de mutation
# LÉGITIME : l'activation (`activate_legal_payment_tier_template`) pose
# `activated_by`/`activated_at` via un vrai `UPDATE`. Un blocage RLS
# `UPDATE` total casserait ce chemin ; une policy `UPDATE` permissive
# (`USING (true) WITH CHECK (true)`) n'offrirait, elle, aucune protection
# réelle (équivalent à l'absence de RLS) — juste une fausse impression de
# rigueur. `ActiveLegalPaymentTierTemplate` a lui aussi un besoin de
# mutation légitime PERMANENT (c'est un pointeur d'état COURANT, pas un
# historique — voir sa docstring, même exception documentée que
# `Task.status`, ticket 006) : y appliquer un verrou d'immutabilité n'aurait
# aucun sens. Pour ces deux tables, la garantie repose sur la discipline
# APPLICATIVE seule (aucune fonction `update`/`delete` n'existe côté
# service pour les champs qui doivent rester figés — `created_by`,
# `created_at`, `country_pack`, `version` sur `LegalPaymentTierTemplate` ;
# seuls `activated_by`/`activated_at`, respectivement `template`, sont
# jamais réécrits, et seulement via les fonctions dédiées) — même
# raisonnement, déjà assumé ailleurs dans ce projet, que
# `organizations_country_pack`/`organizations_organization`/
# `organizations_role` (aucune policy RLS non plus, vérifié au ticket 025).
ENABLE_RLS_SQL = """
ALTER TABLE pricing_legal_payment_tier_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_legal_payment_tier_step FORCE ROW LEVEL SECURITY;

CREATE POLICY pricing_legal_payment_tier_step_select ON pricing_legal_payment_tier_step
    FOR SELECT
    USING (true);

CREATE POLICY pricing_legal_payment_tier_step_insert ON pricing_legal_payment_tier_step
    FOR INSERT
    WITH CHECK (true);
"""

DISABLE_RLS_SQL = """
DROP POLICY IF EXISTS pricing_legal_payment_tier_step_select ON pricing_legal_payment_tier_step;
DROP POLICY IF EXISTS pricing_legal_payment_tier_step_insert ON pricing_legal_payment_tier_step;
ALTER TABLE pricing_legal_payment_tier_step NO FORCE ROW LEVEL SECURITY;
ALTER TABLE pricing_legal_payment_tier_step DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0003_legal_payment_tier_template'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
