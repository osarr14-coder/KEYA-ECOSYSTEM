from django.db import migrations

# Inspection/Reserve/ReserveCorrection portent organization_id — celle du
# LOT inspecté (le constructeur), pas celle de l'inspecteur. Pattern RLS
# standard, identique à Program/Asset/Lot (ticket 002) : voir
# apps/inspections/services.py pour comment l'inspecteur, dont
# l'organisation active diffère toujours de celle-ci par construction,
# bascule explicitement de contexte pour écrire dans ces tables.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

TABLES = [
    'inspections_inspection',
    'inspections_reserve',
    'inspections_reserve_correction',
]


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
        ('inspections', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=_enable_sql(table), reverse_sql=_disable_sql(table))
        for table in TABLES
    ]
