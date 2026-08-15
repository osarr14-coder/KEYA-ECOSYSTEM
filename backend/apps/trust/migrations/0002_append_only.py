from django.db import migrations

# trust_event porte organization_id (RLS scopée comme toute autre table
# métier, voir CLAUDE.md) ET doit être strictement append-only : aucun
# UPDATE/DELETE, jamais, pour personne — ticket 003, critère d'acceptation
# "y compris par un rôle admin".
#
# REVOKE UPDATE/DELETE seul ne suffirait PAS : le rôle applicatif
# (keya_ecosystem_app) est propriétaire de cette table (c'est lui qui a fait
# tourner cette migration), et un propriétaire de table PostgreSQL conserve
# toujours ses privilèges DML implicites quel que soit ce qu'on lui REVOKE
# explicitement — seul un trigger intercepte l'opération avant qu'elle ne
# s'exécute, y compris pour le propriétaire. C'est le même piège que
# "l'owner contourne RLS sans FORCE ROW LEVEL SECURITY" au ticket 001, mais
# pour les privilèges DML bruts plutôt que pour une policy.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

ENABLE_SQL = f"""
ALTER TABLE trust_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_event FORCE ROW LEVEL SECURITY;

CREATE POLICY trust_event_select ON trust_event
    FOR SELECT
    USING (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY trust_event_insert ON trust_event
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

-- Volontairement aucune policy UPDATE/DELETE : le trigger ci-dessous les
-- bloque avant même que RLS n'ait à en juger.

CREATE FUNCTION trust_event_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'trust_event est append-only (ticket 003) : UPDATE et DELETE sont interdits, y compris pour le rôle propriétaire de la table.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trust_event_no_update
    BEFORE UPDATE ON trust_event
    FOR EACH ROW EXECUTE FUNCTION trust_event_reject_mutation();

CREATE TRIGGER trust_event_no_delete
    BEFORE DELETE ON trust_event
    FOR EACH ROW EXECUTE FUNCTION trust_event_reject_mutation();
"""

DISABLE_SQL = """
DROP TRIGGER IF EXISTS trust_event_no_update ON trust_event;
DROP TRIGGER IF EXISTS trust_event_no_delete ON trust_event;
DROP FUNCTION IF EXISTS trust_event_reject_mutation();
DROP POLICY IF EXISTS trust_event_select ON trust_event;
DROP POLICY IF EXISTS trust_event_insert ON trust_event;
ALTER TABLE trust_event NO FORCE ROW LEVEL SECURITY;
ALTER TABLE trust_event DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('trust', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
