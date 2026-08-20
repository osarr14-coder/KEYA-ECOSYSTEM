from django.db import migrations

# `procurement_lot_bc_charge` — ticket B-036. Combine deux garanties dans
# une seule migration de suivi, posées dès la conception de ce modèle (pas
# un retrofit après un flake) :
#
# 1. `sequence` — la colonne existe déjà (migration précédente,
#    `0007_lot_bc_charge.py`, `CreateModel`), mais sans son
#    `DEFAULT nextval()` côté DB. Même garantie qu'un `BIGSERIAL` — ordre
#    d'insertion strict, jamais recalculable après coup.
#    `LotBcCharge.save()` alimente `sequence` explicitement via
#    `nextval()` (le DEFAULT reste un filet pour tout insert hors ORM).
# 2. RLS — policy STANDARD à une seule branche (`organization_id =
#    current_org`), même schéma que `procurement_devis_ajustement`/
#    `procurement_lot_ledger` : `admin_keyimmo` y accède par la bascule RLS
#    déjà positionnée par `create_mission` au moment de la création de la
#    charge (voir `apps.procurement.services.record_bc_charge_for_mission`).
#
#    Aucune policy UPDATE/DELETE définie ici — même conséquence que
#    `Devis`/`DevisAjustement`/`ProgramCost`/`LotLedger` : sous FORCE ROW
#    LEVEL SECURITY, ceci bloque par défaut tout UPDATE/DELETE, y compris
#    pour le rôle propriétaire de la table. Cohérent avec la doctrine
#    append-only de ce modèle (immuable après création).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

SQL = f"""
CREATE SEQUENCE procurement_lot_bc_charge_sequence_seq;
ALTER TABLE procurement_lot_bc_charge ALTER COLUMN sequence SET DEFAULT nextval('procurement_lot_bc_charge_sequence_seq');
ALTER SEQUENCE procurement_lot_bc_charge_sequence_seq OWNED BY procurement_lot_bc_charge.sequence;

ALTER TABLE procurement_lot_bc_charge ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_lot_bc_charge FORCE ROW LEVEL SECURITY;

CREATE POLICY procurement_lot_bc_charge_select ON procurement_lot_bc_charge
    FOR SELECT
    USING (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY procurement_lot_bc_charge_insert ON procurement_lot_bc_charge
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""

REVERSE_SQL = """
DROP POLICY IF EXISTS procurement_lot_bc_charge_select ON procurement_lot_bc_charge;
DROP POLICY IF EXISTS procurement_lot_bc_charge_insert ON procurement_lot_bc_charge;
ALTER TABLE procurement_lot_bc_charge NO FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement_lot_bc_charge DISABLE ROW LEVEL SECURITY;

ALTER TABLE procurement_lot_bc_charge ALTER COLUMN sequence DROP DEFAULT;
DROP SEQUENCE IF EXISTS procurement_lot_bc_charge_sequence_seq;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('procurement', '0007_lot_bc_charge'),
    ]

    operations = [
        migrations.RunSQL(sql=SQL, reverse_sql=REVERSE_SQL),
    ]
