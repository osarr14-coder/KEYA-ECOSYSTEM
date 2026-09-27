from django.db import migrations

# RLS : même policy que sales_reservation. Append-only : mêmes garanties que
# audit_event (aucune policy UPDATE/DELETE, triggers de refus) — un appel de
# fonds émis n'est jamais réécrit (ticket B-050).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"
CURRENT_USER_EXPR = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"

ENABLE_SQL = f"""
ALTER TABLE sales_payment_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_payment_call FORCE ROW LEVEL SECURITY;

CREATE POLICY sales_payment_call_select ON sales_payment_call
    FOR SELECT
    USING (
        organization_id = {CURRENT_ORG_EXPR}
        OR client_id = {CURRENT_USER_EXPR}
    );

CREATE POLICY sales_payment_call_insert ON sales_payment_call
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE FUNCTION sales_payment_call_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'sales_payment_call est append-only (ticket B-050) : un appel de fonds émis ne se modifie ni ne se supprime.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_payment_call_no_update
    BEFORE UPDATE ON sales_payment_call
    FOR EACH ROW EXECUTE FUNCTION sales_payment_call_reject_mutation();

CREATE TRIGGER sales_payment_call_no_delete
    BEFORE DELETE ON sales_payment_call
    FOR EACH ROW EXECUTE FUNCTION sales_payment_call_reject_mutation();
"""

DISABLE_SQL = """
DROP TRIGGER IF EXISTS sales_payment_call_no_update ON sales_payment_call;
DROP TRIGGER IF EXISTS sales_payment_call_no_delete ON sales_payment_call;
DROP FUNCTION IF EXISTS sales_payment_call_reject_mutation();
DROP POLICY IF EXISTS sales_payment_call_select ON sales_payment_call;
DROP POLICY IF EXISTS sales_payment_call_insert ON sales_payment_call;
ALTER TABLE sales_payment_call NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_payment_call DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0005_paymentcall_and_more'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
