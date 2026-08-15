from django.db import migrations

# Document/WorkDeclaration/Evidence portent tous organization_id dénormalisé
# — pattern standard déjà établi pour Program/Asset/Lot (ticket 002), aucune
# branche "ma propre ligne" nécessaire ici (voir CLAUDE.md, RLS multi-tenant).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

TABLES = [
    'evidence_document',
    'evidence_work_declaration',
    'evidence_evidence',
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
        ('evidence', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=_enable_sql(table), reverse_sql=_disable_sql(table))
        for table in TABLES
    ]
