from django.db import migrations

# RLS (ticket B-052) : l'organisation du programme (le « compte ») lit et
# écrit ; l'organisation BÉNÉFICIAIRE lit seulement ses propres sorties —
# branche étroite, même esprit que sales_reservation (client_id). Aucune
# policy DELETE.
#
# Garanties en base (CDC V3 §8.2/§8.3) : montant, devise, bénéficiaire,
# jalon, lot et programme immuables ; référence, date et auteur
# d'exécution immuables une fois posés ; statut de demande selon le graphe
# DRAFT → ELIGIBLE → EXECUTED_SIM (retour ELIGIBLE → DRAFT sur caducité,
# CANCELLED avant exécution), EXECUTED_SIM et CANCELLED terminaux ; statut de
# preuve jamais en arrière ; aucune suppression.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

ENABLE_SQL = f"""
ALTER TABLE sales_disbursement ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_disbursement FORCE ROW LEVEL SECURITY;

CREATE POLICY sales_disbursement_select ON sales_disbursement
    FOR SELECT
    USING (
        organization_id = {CURRENT_ORG_EXPR}
        OR beneficiary_organization_id = {CURRENT_ORG_EXPR}
    );

CREATE POLICY sales_disbursement_insert ON sales_disbursement
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY sales_disbursement_update ON sales_disbursement
    FOR UPDATE
    USING (organization_id = {CURRENT_ORG_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE FUNCTION sales_disbursement_flow_rank(flow text) RETURNS integer AS $$
    SELECT CASE flow
        WHEN 'planned' THEN 0
        WHEN 'bank_executed_sim' THEN 1
        WHEN 'beneficiary_confirmed_sim' THEN 2
        WHEN 'reconciled_sim' THEN 3
    END;
$$ LANGUAGE sql IMMUTABLE;

CREATE FUNCTION sales_disbursement_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'sales_disbursement : un décaissement ne se supprime jamais (ticket B-052).';
    END IF;
    IF NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR NEW.beneficiary_organization_id IS DISTINCT FROM OLD.beneficiary_organization_id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.program_id IS DISTINCT FROM OLD.program_id
        OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
        OR NEW.milestone_id IS DISTINCT FROM OLD.milestone_id
        OR NEW.prepared_by_id IS DISTINCT FROM OLD.prepared_by_id THEN
        RAISE EXCEPTION 'sales_disbursement : montant, devise, bénéficiaire, jalon et programme sont immuables (ticket B-052, CDC §8.3).';
    END IF;
    IF (OLD.bank_reference IS NOT NULL AND NEW.bank_reference IS DISTINCT FROM OLD.bank_reference)
        OR (OLD.executed_on IS NOT NULL AND NEW.executed_on IS DISTINCT FROM OLD.executed_on)
        OR (OLD.executed_by_id IS NOT NULL AND NEW.executed_by_id IS DISTINCT FROM OLD.executed_by_id)
        OR (OLD.beneficiary_confirmed_at IS NOT NULL AND NEW.beneficiary_confirmed_at IS DISTINCT FROM OLD.beneficiary_confirmed_at)
        OR (OLD.reconciled_at IS NOT NULL AND NEW.reconciled_at IS DISTINCT FROM OLD.reconciled_at) THEN
        RAISE EXCEPTION 'sales_disbursement : une preuve d''exécution, de confirmation ou de rapprochement ne se modifie jamais (ticket B-052).';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'draft' AND NEW.status IN ('eligible', 'cancelled'))
        OR (OLD.status = 'eligible' AND NEW.status IN ('draft', 'executed_sim', 'cancelled'))
    ) THEN
        RAISE EXCEPTION 'sales_disbursement : transition % → % interdite (ticket B-052, CDC §8.2).', OLD.status, NEW.status;
    END IF;
    IF sales_disbursement_flow_rank(NEW.flow_status) < sales_disbursement_flow_rank(OLD.flow_status) THEN
        RAISE EXCEPTION 'sales_disbursement : le statut de preuve ne revient jamais en arrière (ticket B-052).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_disbursement_guard_update
    BEFORE UPDATE ON sales_disbursement
    FOR EACH ROW EXECUTE FUNCTION sales_disbursement_guard();

CREATE TRIGGER sales_disbursement_guard_delete
    BEFORE DELETE ON sales_disbursement
    FOR EACH ROW EXECUTE FUNCTION sales_disbursement_guard();
"""

DISABLE_SQL = """
DROP TRIGGER IF EXISTS sales_disbursement_guard_update ON sales_disbursement;
DROP TRIGGER IF EXISTS sales_disbursement_guard_delete ON sales_disbursement;
DROP FUNCTION IF EXISTS sales_disbursement_guard();
DROP FUNCTION IF EXISTS sales_disbursement_flow_rank(text);
DROP POLICY IF EXISTS sales_disbursement_select ON sales_disbursement;
DROP POLICY IF EXISTS sales_disbursement_insert ON sales_disbursement;
DROP POLICY IF EXISTS sales_disbursement_update ON sales_disbursement;
ALTER TABLE sales_disbursement NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_disbursement DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0009_disbursement'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
