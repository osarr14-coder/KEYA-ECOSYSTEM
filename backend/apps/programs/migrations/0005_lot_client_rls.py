from django.db import migrations

# Même pattern que 0002_programs_rls.py (cas simple, pas de branche "ma
# propre ligne") — `programs_lot_client` porte un `organization_id`
# dénormalisé comme le reste de cette app.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

TABLE = 'programs_lot_client'


def _enable_sql(table):
    return f"""
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;

CREATE POLICY {table}_scope ON {table}
    FOR ALL
    USING (organization_id = {CURRENT_ORG_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""


def _disable_sql(table):
    return f"""
DROP POLICY IF EXISTS {table}_scope ON {table};
ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('programs', '0004_asset_location_lotclient_and_more'),
    ]

    operations = [
        migrations.RunSQL(sql=_enable_sql(TABLE), reverse_sql=_disable_sql(TABLE)),
    ]
