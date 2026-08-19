from django.db import migrations

# `pricing_pricingconfig` — ticket 025, décision de conception (point C) :
# même rigueur d'immutabilité que `procurement_devis`/`trust_event`
# (tickets 022/003), pas une simple discipline applicative comme
# `organizations_country_pack`/`organizations_organization`/
# `organizations_role` (aucune policy RLS aujourd'hui, vérifié avant de
# proposer ce ticket).
#
# Policies `SELECT`/`INSERT` PERMISSIVES (`USING (true)` / `WITH CHECK
# (true)`) : `PricingConfig` n'a pas de colonne `organization_id`
# naturelle (rattaché à `CountryPack`, pas à une organisation) — aucune
# frontière organisationnelle à faire respecter par RLS ici. La
# restriction de LECTURE à `admin_keyimmo` (point B) est une permission
# DRF (`IsAdminKeyimmo`), jamais une policy RLS.
#
# **Aucune policy `UPDATE`/`DELETE`** : sous `FORCE ROW LEVEL SECURITY`,
# ceci bloque ces deux commandes par défaut, y compris pour le rôle
# propriétaire de la table — même mécanisme que `procurement_devis`
# (migration `0002_devis_rls.py`, ticket 022) et `trust_event` (ticket
# 003, absence de policy UPDATE/DELETE + trigger `BEFORE UPDATE/DELETE`
# en filet supplémentaire — pas repris ici, un seul filet RLS suffit pour
# ce ticket, pas trois couches comme `TrustEvent` qui doit résister à un
# contournement DEPUIS Django lui-même en plus du SQL brut, voir CLAUDE.md
# section Append-only : `PricingConfig` n'expose de toute façon aucune
# fonction `update`/`delete` côté service, layer 1 déjà assuré par
# construction — pas de fonction à contourner).
ENABLE_RLS_SQL = """
ALTER TABLE pricing_pricingconfig ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_pricingconfig FORCE ROW LEVEL SECURITY;

CREATE POLICY pricing_pricingconfig_select ON pricing_pricingconfig
    FOR SELECT
    USING (true);

CREATE POLICY pricing_pricingconfig_insert ON pricing_pricingconfig
    FOR INSERT
    WITH CHECK (true);
"""

DISABLE_RLS_SQL = """
DROP POLICY IF EXISTS pricing_pricingconfig_select ON pricing_pricingconfig;
DROP POLICY IF EXISTS pricing_pricingconfig_insert ON pricing_pricingconfig;
ALTER TABLE pricing_pricingconfig NO FORCE ROW LEVEL SECURITY;
ALTER TABLE pricing_pricingconfig DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
