from django.db import migrations

# Program/Asset/Lot/Milestone portent tous un `organization_id` dénormalisé
# (voir apps/programs/models.py) : contrairement à `organizations_membership`
# (ticket 001), ce ne sont pas des lignes d'identité — la policy est donc le
# cas simple du pattern documenté dans CLAUDE.md, sans branche "ma propre
# ligne". `MilestoneTemplate`/`MilestoneTemplateStep` ne sont PAS scopées :
# ce sont des données de référence par CountryPack, partagées entre
# organisations (pas de tenant sur une donnée de configuration pays).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

TABLES = [
    'programs_program',
    'programs_asset',
    'programs_lot',
    'programs_milestone',
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
        ('programs', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=_enable_sql(table), reverse_sql=_disable_sql(table))
        for table in TABLES
    ]
