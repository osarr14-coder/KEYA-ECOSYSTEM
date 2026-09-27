from django.db import migrations

# RLS (ticket B-056) : même policy que sales_reservation — organisation du
# lot OU client lui-même (le client lit ses propres avis). Insertion sous le
# contexte de l'organisation du lot (le service y bascule), mise à jour par
# cette organisation seule (Finance, sous bascule). Aucune policy DELETE.
# Garde : montant, appel, client, référence, date immuables ; statut en
# avant seulement (declared → confirmed | rejected).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"
CURRENT_USER_EXPR = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"

ENABLE_SQL = f"""
ALTER TABLE sales_payment_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_payment_notice FORCE ROW LEVEL SECURITY;

CREATE POLICY sales_payment_notice_select ON sales_payment_notice
    FOR SELECT
    USING (
        organization_id = {CURRENT_ORG_EXPR}
        OR client_id = {CURRENT_USER_EXPR}
    );

CREATE POLICY sales_payment_notice_insert ON sales_payment_notice
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY sales_payment_notice_update ON sales_payment_notice
    FOR UPDATE
    USING (organization_id = {CURRENT_ORG_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE FUNCTION sales_payment_notice_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'sales_payment_notice : un avis de paiement ne se supprime jamais (ticket B-056).';
    END IF;
    IF NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR NEW.payment_call_id IS DISTINCT FROM OLD.payment_call_id
        OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
        OR NEW.client_id IS DISTINCT FROM OLD.client_id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.client_reference IS DISTINCT FROM OLD.client_reference
        OR NEW.paid_on IS DISTINCT FROM OLD.paid_on THEN
        RAISE EXCEPTION 'sales_payment_notice : une déclaration du client ne se modifie jamais (ticket B-056).';
    END IF;
    IF OLD.status <> 'declared' AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'sales_payment_notice : un avis traité ne change plus de statut (ticket B-056).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_payment_notice_guard_update
    BEFORE UPDATE ON sales_payment_notice
    FOR EACH ROW EXECUTE FUNCTION sales_payment_notice_guard();

CREATE TRIGGER sales_payment_notice_guard_delete
    BEFORE DELETE ON sales_payment_notice
    FOR EACH ROW EXECUTE FUNCTION sales_payment_notice_guard();
"""

DISABLE_SQL = """
DROP TRIGGER IF EXISTS sales_payment_notice_guard_update ON sales_payment_notice;
DROP TRIGGER IF EXISTS sales_payment_notice_guard_delete ON sales_payment_notice;
DROP FUNCTION IF EXISTS sales_payment_notice_guard();
DROP POLICY IF EXISTS sales_payment_notice_select ON sales_payment_notice;
DROP POLICY IF EXISTS sales_payment_notice_insert ON sales_payment_notice;
DROP POLICY IF EXISTS sales_payment_notice_update ON sales_payment_notice;
ALTER TABLE sales_payment_notice NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_payment_notice DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0011_reservation_validation_payment_notice'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
