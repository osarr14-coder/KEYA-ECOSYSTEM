from django.db import migrations

# `messaging_message` porte un `organization_id` dénormalisé depuis son
# sujet (voir apps/messaging/models.py) — cas simple du pattern documenté
# dans CLAUDE.md, identique à celui de programs/0002 (pas de branche "ma
# propre ligne" : un message reste visible à tout membre de l'organisation
# qui a accès au sujet référencé, jamais restreint à son seul auteur).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

ENABLE_RLS_SQL = f"""
ALTER TABLE messaging_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging_message FORCE ROW LEVEL SECURITY;

CREATE POLICY messaging_message_scope ON messaging_message
    FOR ALL
    USING (organization_id = {CURRENT_ORG_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""

DISABLE_RLS_SQL = """
DROP POLICY IF EXISTS messaging_message_scope ON messaging_message;
ALTER TABLE messaging_message NO FORCE ROW LEVEL SECURITY;
ALTER TABLE messaging_message DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('messaging', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
