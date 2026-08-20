from django.db import migrations, models

# `get_active_rate` (apps/pricing/services.py) triait uniquement par
# `-created_at` — deux `PricingConfig` du même `(country_pack, canal)`
# créés via deux requêtes HTTP quasi simultanées peuvent avoir un timestamp
# trop proche pour être départagé de façon fiable, un ordre non déterministe
# pouvant faire remonter un taux qui n'est PAS le plus récent comme « actif »
# — risque financier direct, `get_active_rate` alimente `apps.procurement.
# services._derive_marge_estimee` (invariant 25.15, CLAUDE.md). Bug trouvé
# comme flake documenté depuis le ticket B-027
# (`TestPricingConfigCurrentAndHistory::
# test_current_returns_the_latest_rate_per_canal`), corrigé au ticket B-031
# — même classe de bug, même remède que `TrustEvent.sequence`
# (`apps/trust/migrations/0004_trustevent_sequence.py`, ticket 013 bis).
# `sequence` fournit un critère de tri secondaire garanti strictement
# croissant à l'insertion (séquence Postgres dédiée, BIGSERIAL-like), jamais
# recalculable après coup.
#
# Plus simple que la migration équivalente de `TrustEvent` :
# `pricing_pricingconfig` ne porte AUCUN trigger append-only personnalisé
# (seulement RLS — `SELECT`/`INSERT` permissifs, aucune policy `UPDATE`/
# `DELETE`, voir migration `0002_pricingconfig_rls.py`) — seul `FORCE ROW
# LEVEL SECURITY` doit être basculé temporairement autour du backfill
# (`UPDATE ... SET sequence = ...`, no-op en pratique tant que la table
# reste petite, correct pour un futur déploiement avec des données réelles).
SQL = """
ALTER TABLE pricing_pricingconfig NO FORCE ROW LEVEL SECURITY;

CREATE SEQUENCE pricing_pricingconfig_sequence_seq;
ALTER TABLE pricing_pricingconfig ADD COLUMN sequence bigint;
UPDATE pricing_pricingconfig SET sequence = nextval('pricing_pricingconfig_sequence_seq');
ALTER TABLE pricing_pricingconfig ALTER COLUMN sequence SET NOT NULL;
ALTER TABLE pricing_pricingconfig ADD CONSTRAINT pricing_pricingconfig_sequence_key UNIQUE (sequence);
ALTER TABLE pricing_pricingconfig ALTER COLUMN sequence SET DEFAULT nextval('pricing_pricingconfig_sequence_seq');
ALTER SEQUENCE pricing_pricingconfig_sequence_seq OWNED BY pricing_pricingconfig.sequence;

ALTER TABLE pricing_pricingconfig FORCE ROW LEVEL SECURITY;
"""

REVERSE_SQL = """
ALTER TABLE pricing_pricingconfig NO FORCE ROW LEVEL SECURITY;

ALTER TABLE pricing_pricingconfig DROP CONSTRAINT pricing_pricingconfig_sequence_key;
ALTER TABLE pricing_pricingconfig DROP COLUMN sequence;
DROP SEQUENCE IF EXISTS pricing_pricingconfig_sequence_seq;

ALTER TABLE pricing_pricingconfig FORCE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0004_legal_payment_tier_step_rls'),
    ]

    operations = [
        migrations.RunSQL(
            sql=SQL,
            reverse_sql=REVERSE_SQL,
            state_operations=[
                migrations.AddField(
                    model_name='pricingconfig',
                    name='sequence',
                    field=models.BigIntegerField(unique=True, editable=False, default=0),
                    preserve_default=False,
                ),
            ],
        ),
    ]
