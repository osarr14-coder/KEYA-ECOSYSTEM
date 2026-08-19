from django.db import migrations

# `procurement_devis_ajustement` — ticket 023. Policy STANDARD à une seule
# branche (`organization_id = current_org`), contrairement à
# `procurement_devis` (ticket 022, deux branches) : aucune lecture
# candidate de ce modèle dans ce ticket (décision de conception, point C —
# voir 023-reconciliation-devis-ajustement.md), donc pas besoin d'une
# seconde branche `candidate_organization_id`. `admin_keyimmo` y accède par
# la même bascule RLS explicite que pour `Devis` lui-même (voir
# apps/procurement/services.py).
#
# Aucune policy UPDATE/DELETE définie ici non plus — même conséquence que
# `Devis` (voir 0002_devis_rls.py) : sous FORCE ROW LEVEL SECURITY, ceci
# bloque par défaut tout UPDATE/DELETE, y compris pour le rôle propriétaire
# de la table. Cohérent avec le critère d'acceptation central du ticket 023
# (aucune modification de Devis OU de ses ajustements après coup).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

ENABLE_RLS_SQL = f"""
ALTER TABLE procurement_devis_ajustement ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_devis_ajustement FORCE ROW LEVEL SECURITY;

CREATE POLICY procurement_devis_ajustement_select ON procurement_devis_ajustement
    FOR SELECT
    USING (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY procurement_devis_ajustement_insert ON procurement_devis_ajustement
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""

DISABLE_RLS_SQL = """
DROP POLICY IF EXISTS procurement_devis_ajustement_select ON procurement_devis_ajustement;
DROP POLICY IF EXISTS procurement_devis_ajustement_insert ON procurement_devis_ajustement;
ALTER TABLE procurement_devis_ajustement NO FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement_devis_ajustement DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('procurement', '0003_devis_marge_estimee_devisajustement'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
