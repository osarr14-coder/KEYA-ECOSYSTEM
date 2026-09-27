from django.db import migrations

# Audit UI R1 (R02, PO-2026-09-27-09) — l'administrateur n'a aucun pouvoir
# métier : la visibilité et la résolution transverses des litiges passent au
# gestionnaire (`gestionnaire_adv`). Même mécanique que 0002 (sous-requête
# sur organizations_membership limitée à l'utilisateur courant), seul le
# rôle change. Aucune donnée modifiée.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"
CURRENT_USER_EXPR = "current_setting('app.current_user_id', true)::uuid"


def _has_role(code):
    return f"""EXISTS (
        SELECT 1 FROM organizations_membership
        JOIN organizations_role ON organizations_role.id = organizations_membership.role_id
        WHERE organizations_membership.user_id = {CURRENT_USER_EXPR}
          AND organizations_role.code = '{code}'
    )"""


def _policies(code):
    role = _has_role(code)
    return f"""
DROP POLICY IF EXISTS support_litige_select ON support_litige;
DROP POLICY IF EXISTS support_litige_update ON support_litige;

CREATE POLICY support_litige_select ON support_litige
    FOR SELECT
    USING (organization_id = {CURRENT_ORG_EXPR} OR {role});

CREATE POLICY support_litige_update ON support_litige
    FOR UPDATE
    USING (organization_id = {CURRENT_ORG_EXPR} OR {role})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR} OR {role});
"""


class Migration(migrations.Migration):

    dependencies = [
        ('support', '0002_rls'),
    ]

    operations = [
        migrations.RunSQL(sql=_policies('gestionnaire_adv'), reverse_sql=_policies('admin_keyimmo')),
    ]
