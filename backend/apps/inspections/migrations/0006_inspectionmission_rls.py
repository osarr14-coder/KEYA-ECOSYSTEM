from django.db import migrations

# `inspections_mission` — ticket 012. Contrairement au pattern standard
# (une seule policy FOR ALL, `organization_id = current_org`, voir 0002_rls),
# la lecture autorise EN PLUS `assigned_inspector_id = current_user` :
# l'inspecteur assigné n'est par construction jamais membre de
# l'organisation cible (règle d'indépendance, ticket 005), il a donc besoin
# d'un second chemin de visibilité pour lire SES PROPRES missions
# cross-organisation.
#
# Comparaison de COLONNE, jamais une sous-requête sur cette même table —
# c'est précisément ce qui a fait échouer la tentative d'élargissement RLS
# du ticket 011 (`membership_select` + `OR EXISTS (SELECT ... FROM
# organizations_membership ...)` → récursion infinie détectée par Postgres
# sous FORCE ROW LEVEL SECURITY). Cette policy-ci n'interroge jamais
# `inspections_mission` depuis sa propre définition : aucun risque
# structurel de récursion.
#
# INSERT reste strict (`organization_id = current_org` seul, comme le
# pattern standard) : la création passe par une bascule explicite de
# contexte RLS vers l'organisation cible (voir
# apps/inspections/services.py::create_mission), jamais par un
# élargissement de la policy d'écriture elle-même — admin_keyimmo n'a besoin
# d'aucun droit d'écriture spécial, seulement d'emprunter temporairement le
# contexte de l'organisation cible, exactement comme create_inspection.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"
CURRENT_USER_EXPR = "current_setting('app.current_user_id', true)::uuid"

ENABLE_RLS_SQL = f"""
ALTER TABLE inspections_mission ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections_mission FORCE ROW LEVEL SECURITY;

CREATE POLICY inspections_mission_select ON inspections_mission
    FOR SELECT
    USING (
        organization_id = {CURRENT_ORG_EXPR}
        OR assigned_inspector_id = {CURRENT_USER_EXPR}
    );

CREATE POLICY inspections_mission_insert ON inspections_mission
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""

DISABLE_RLS_SQL = """
DROP POLICY IF EXISTS inspections_mission_select ON inspections_mission;
DROP POLICY IF EXISTS inspections_mission_insert ON inspections_mission;
ALTER TABLE inspections_mission NO FORCE ROW LEVEL SECURITY;
ALTER TABLE inspections_mission DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('inspections', '0005_inspectionmission'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
