from django.db import migrations

# RLS : même policy que sales_reservation (organisation du lot OU client).
# Garanties en base (ticket B-051, CDC V3 §8.3) : un encaissement enregistré
# garde ses montant, devise, réservation, client, référence et date ; son
# statut n'avance que vers le rapprochement ; rien ne se supprime. Une
# affectation est append-only (contrepassation hors MVP).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"
CURRENT_USER_EXPR = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"


def _rls(table, with_update):
    update_policy = f"""
CREATE POLICY {table}_update ON {table}
    FOR UPDATE
    USING (organization_id = {CURRENT_ORG_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
""" if with_update else ''
    return f"""
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;

CREATE POLICY {table}_select ON {table}
    FOR SELECT
    USING (
        organization_id = {CURRENT_ORG_EXPR}
        OR client_id = {CURRENT_USER_EXPR}
    );

CREATE POLICY {table}_insert ON {table}
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
{update_policy}"""


ENABLE_SQL = _rls('sales_customer_receipt', with_update=True) + _rls('sales_allocation', with_update=False) + """
CREATE FUNCTION sales_customer_receipt_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'sales_customer_receipt : un encaissement enregistré ne se supprime jamais (ticket B-051).';
    END IF;
    IF NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
        OR NEW.client_id IS DISTINCT FROM OLD.client_id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.bank_reference IS DISTINCT FROM OLD.bank_reference
        OR NEW.received_on IS DISTINCT FROM OLD.received_on THEN
        RAISE EXCEPTION 'sales_customer_receipt : montant, devise, dossier, client, référence et date d''un encaissement sont immuables (ticket B-051, CDC §8.3).';
    END IF;
    IF OLD.status = 'reconciled_sim' AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'sales_customer_receipt : un encaissement rapproché ne revient jamais en arrière (ticket B-051).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_customer_receipt_guard_update
    BEFORE UPDATE ON sales_customer_receipt
    FOR EACH ROW EXECUTE FUNCTION sales_customer_receipt_guard();

CREATE TRIGGER sales_customer_receipt_guard_delete
    BEFORE DELETE ON sales_customer_receipt
    FOR EACH ROW EXECUTE FUNCTION sales_customer_receipt_guard();

CREATE FUNCTION sales_allocation_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'sales_allocation est append-only (ticket B-051) : une affectation ne se modifie ni ne se supprime.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_allocation_no_update
    BEFORE UPDATE ON sales_allocation
    FOR EACH ROW EXECUTE FUNCTION sales_allocation_reject_mutation();

CREATE TRIGGER sales_allocation_no_delete
    BEFORE DELETE ON sales_allocation
    FOR EACH ROW EXECUTE FUNCTION sales_allocation_reject_mutation();
"""

DISABLE_SQL = """
DROP TRIGGER IF EXISTS sales_allocation_no_update ON sales_allocation;
DROP TRIGGER IF EXISTS sales_allocation_no_delete ON sales_allocation;
DROP FUNCTION IF EXISTS sales_allocation_reject_mutation();
DROP TRIGGER IF EXISTS sales_customer_receipt_guard_update ON sales_customer_receipt;
DROP TRIGGER IF EXISTS sales_customer_receipt_guard_delete ON sales_customer_receipt;
DROP FUNCTION IF EXISTS sales_customer_receipt_guard();
DROP POLICY IF EXISTS sales_allocation_select ON sales_allocation;
DROP POLICY IF EXISTS sales_allocation_insert ON sales_allocation;
ALTER TABLE sales_allocation NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_allocation DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_customer_receipt_select ON sales_customer_receipt;
DROP POLICY IF EXISTS sales_customer_receipt_insert ON sales_customer_receipt;
DROP POLICY IF EXISTS sales_customer_receipt_update ON sales_customer_receipt;
ALTER TABLE sales_customer_receipt NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_customer_receipt DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0007_customerreceipt_allocation_and_more'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
