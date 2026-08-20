from django.db import migrations

# `procurement_lot_ledger` — ticket B-035. Policy STANDARD à une seule
# branche (`organization_id = current_org`), même schéma que
# `procurement_devis_ajustement` (0004_devisajustement_rls.py) : aucun
# second acteur cross-organisation ici (contrairement à `procurement_devis`,
# qui a une branche candidate) — `admin_keyimmo` y accède par bascule RLS
# explicite (voir apps/procurement/services.py::create_lot_ledger).
#
# Aucune policy UPDATE/DELETE définie ici — même conséquence que `Devis`/
# `DevisAjustement`/`ProgramCost` : sous FORCE ROW LEVEL SECURITY, ceci
# bloque par défaut tout UPDATE/DELETE, y compris pour le rôle propriétaire
# de la table. Cohérent avec la décision de conception C du ticket
# (immutabilité — `LotLedger` n'est jamais révisé après création, la
# contrainte UNIQUE du OneToOneField `lot` garantit qu'au plus une ligne
# existe par lot).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

ENABLE_RLS_SQL = f"""
ALTER TABLE procurement_lot_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_lot_ledger FORCE ROW LEVEL SECURITY;

CREATE POLICY procurement_lot_ledger_select ON procurement_lot_ledger
    FOR SELECT
    USING (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY procurement_lot_ledger_insert ON procurement_lot_ledger
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""

DISABLE_RLS_SQL = """
DROP POLICY IF EXISTS procurement_lot_ledger_select ON procurement_lot_ledger;
DROP POLICY IF EXISTS procurement_lot_ledger_insert ON procurement_lot_ledger;
ALTER TABLE procurement_lot_ledger NO FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement_lot_ledger DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('procurement', '0005_lot_ledger'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
