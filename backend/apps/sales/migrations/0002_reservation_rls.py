from django.db import migrations

# Précédent : inspections/migrations/0006_inspectionmission_rls.py (ticket
# 011). Lecture : l'organisation du lot OU le client lui-même (il n'est
# jamais membre de l'organisation du programme). Écriture : uniquement sous
# bascule explicite vers l'organisation du lot, faite par apps/sales/
# services.py — jamais une policy d'écriture ouverte au client.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"
# NULLIF : une variable de session déjà définie puis sortie de sa
# transaction vaut '' (pas NULL) — `''::uuid` ferait échouer TOUTE lecture de
# la table sous un contexte organisation seul (reproduit en écrivant les
# tests de ce ticket). Vide = aucune branche client, jamais une erreur.
CURRENT_USER_EXPR = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"

ENABLE_SQL = f"""
ALTER TABLE sales_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_reservation FORCE ROW LEVEL SECURITY;

CREATE POLICY sales_reservation_select ON sales_reservation
    FOR SELECT
    USING (
        organization_id = {CURRENT_ORG_EXPR}
        OR client_id = {CURRENT_USER_EXPR}
    );

CREATE POLICY sales_reservation_insert ON sales_reservation
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY sales_reservation_update ON sales_reservation
    FOR UPDATE
    USING (organization_id = {CURRENT_ORG_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""

DISABLE_SQL = """
DROP POLICY IF EXISTS sales_reservation_select ON sales_reservation;
DROP POLICY IF EXISTS sales_reservation_insert ON sales_reservation;
DROP POLICY IF EXISTS sales_reservation_update ON sales_reservation;
ALTER TABLE sales_reservation NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_reservation DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
