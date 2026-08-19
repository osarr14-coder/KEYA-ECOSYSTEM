from django.db import migrations

# `procurement_devis` — ticket 022. Même schéma que `inspections_mission`
# (ticket 012, voir apps/inspections/migrations/0006_inspectionmission_rls.py) :
# policy de lecture à DEUX branches par comparaison de COLONNE, jamais une
# sous-requête sur cette même table (récursion RLS documentée au ticket 011).
#
# `candidate_organization_id = current_org` : une organisation candidate
# n'est par construction pas nécessairement membre de `organization` (celle
# du lot) — elle a besoin d'un second chemin de visibilité pour lire SES
# PROPRES devis cross-organisation, sans bascule de contexte nécessaire.
#
# INSERT reste strict (`organization_id = current_org` seul, comme le
# pattern standard) : la création passe par une bascule explicite de
# contexte RLS vers l'organisation cible (voir
# apps/procurement/services.py::create_devis), jamais par un élargissement
# de la policy d'écriture — admin_keyimmo n'a besoin d'aucun droit
# d'écriture spécial, seulement d'emprunter temporairement le contexte de
# l'organisation cible, exactement comme create_inspection/create_mission.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

ENABLE_RLS_SQL = f"""
ALTER TABLE procurement_devis ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_devis FORCE ROW LEVEL SECURITY;

CREATE POLICY procurement_devis_select ON procurement_devis
    FOR SELECT
    USING (
        organization_id = {CURRENT_ORG_EXPR}
        OR candidate_organization_id = {CURRENT_ORG_EXPR}
    );

CREATE POLICY procurement_devis_insert ON procurement_devis
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""

DISABLE_RLS_SQL = """
DROP POLICY IF EXISTS procurement_devis_select ON procurement_devis;
DROP POLICY IF EXISTS procurement_devis_insert ON procurement_devis;
ALTER TABLE procurement_devis NO FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement_devis DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('procurement', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
