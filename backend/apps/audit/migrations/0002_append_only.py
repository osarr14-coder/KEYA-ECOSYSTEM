from django.db import migrations

# Même garanties que trust/migrations/0002_append_only.py (ticket 003) :
# lecture/insertion par organisation, aucune policy UPDATE/DELETE, triggers
# qui refusent toute modification même au propriétaire de la table.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

ENABLE_SQL = f"""
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_event_select ON audit_event
    FOR SELECT
    USING (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY audit_event_insert ON audit_event
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE FUNCTION audit_event_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'audit_event est append-only (ticket B-048) : UPDATE et DELETE sont interdits, y compris pour le rôle propriétaire de la table.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update
    BEFORE UPDATE ON audit_event
    FOR EACH ROW EXECUTE FUNCTION audit_event_reject_mutation();

CREATE TRIGGER audit_event_no_delete
    BEFORE DELETE ON audit_event
    FOR EACH ROW EXECUTE FUNCTION audit_event_reject_mutation();
"""

DISABLE_SQL = """
DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event;
DROP TRIGGER IF EXISTS audit_event_no_delete ON audit_event;
DROP FUNCTION IF EXISTS audit_event_reject_mutation();
DROP POLICY IF EXISTS audit_event_select ON audit_event;
DROP POLICY IF EXISTS audit_event_insert ON audit_event;
ALTER TABLE audit_event NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_event DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('audit', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
