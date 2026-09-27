from django.db import migrations

# RLS : même policy que sales_reservation (migration 0002). Garde : CDC T04
# assuré EN BASE — même doctrine que trust_event/audit_event, la garantie ne
# dépend pas du code applicatif (ticket B-049).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"
CURRENT_USER_EXPR = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"

ENABLE_SQL = f"""
ALTER TABLE sales_contract_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_contract_version FORCE ROW LEVEL SECURITY;

CREATE POLICY sales_contract_version_select ON sales_contract_version
    FOR SELECT
    USING (
        organization_id = {CURRENT_ORG_EXPR}
        OR client_id = {CURRENT_USER_EXPR}
    );

CREATE POLICY sales_contract_version_insert ON sales_contract_version
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY sales_contract_version_update ON sales_contract_version
    FOR UPDATE
    USING (organization_id = {CURRENT_ORG_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE FUNCTION sales_contract_version_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'sales_contract_version : une version de contrat ne se supprime jamais (ticket B-049).';
    END IF;
    IF OLD.status = 'signed_simulated' THEN
        RAISE EXCEPTION
            'sales_contract_version : une version signée est immuable (ticket B-049, CDC T04) — créez une nouvelle version.';
    END IF;
    IF OLD.status <> 'draft' AND NEW.content IS DISTINCT FROM OLD.content THEN
        RAISE EXCEPTION
            'sales_contract_version : le contenu est figé dès la soumission (ticket B-049) — créez une nouvelle version.';
    END IF;
    IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
        OR NEW.version IS DISTINCT FROM OLD.version
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
        RAISE EXCEPTION
            'sales_contract_version : réservation, numéro, organisation et client d''une version sont immuables (ticket B-049).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_contract_version_guard_update
    BEFORE UPDATE ON sales_contract_version
    FOR EACH ROW EXECUTE FUNCTION sales_contract_version_guard();

CREATE TRIGGER sales_contract_version_guard_delete
    BEFORE DELETE ON sales_contract_version
    FOR EACH ROW EXECUTE FUNCTION sales_contract_version_guard();
"""

DISABLE_SQL = """
DROP TRIGGER IF EXISTS sales_contract_version_guard_update ON sales_contract_version;
DROP TRIGGER IF EXISTS sales_contract_version_guard_delete ON sales_contract_version;
DROP FUNCTION IF EXISTS sales_contract_version_guard();
DROP POLICY IF EXISTS sales_contract_version_select ON sales_contract_version;
DROP POLICY IF EXISTS sales_contract_version_insert ON sales_contract_version;
DROP POLICY IF EXISTS sales_contract_version_update ON sales_contract_version;
ALTER TABLE sales_contract_version NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_contract_version DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0003_contractversion_and_more'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
