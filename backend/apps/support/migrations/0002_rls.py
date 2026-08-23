from django.db import migrations

# support_litige : policy standard par organisation active (comme le reste
# du projet) PLUS une branche transverse pour admin_keyimmo (ticket B-041,
# Gate 3 item 4) — premier précédent de ce type dans le projet.
#
# La branche admin_keyimmo interroge organizations_membership, une table
# DIFFÉRENTE de celle protégée par CETTE policy — donc pas la récursion
# rencontrée et abandonnée au ticket 011 pour une policy qui aurait
# référencé organizations_membership DEPUIS SA PROPRE policy (voir
# apps/backoffice/services.py::get_user_memberships). Le SELECT sur
# organizations_membership à l'intérieur de cette sous-requête reste lui
# aussi soumis à SA PROPRE policy existante (`membership_select`,
# `user_id = current_setting('app.current_user_id')`) — mais comme on ne
# cherche jamais que les lignes de L'UTILISATEUR COURANT (le même
# app.current_user_id), cette policy ne restreint rien ici : elle est déjà
# alignée avec ce qu'on cherche. Aucun contournement RLS nécessaire, aucun
# SECURITY DEFINER.
#
# INSERT reste strictement standard (organisation active seule) : un admin
# ne crée jamais de litige, seul le client le fait (apps/home, ticket
# B-041) — pas de branche admin_keyimmo sur cette policy-là.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"
CURRENT_USER_EXPR = "current_setting('app.current_user_id', true)::uuid"

IS_ADMIN_KEYIMMO_EXPR = f"""EXISTS (
        SELECT 1 FROM organizations_membership
        JOIN organizations_role ON organizations_role.id = organizations_membership.role_id
        WHERE organizations_membership.user_id = {CURRENT_USER_EXPR}
          AND organizations_role.code = 'admin_keyimmo'
    )"""

ENABLE_SQL = f"""
ALTER TABLE support_litige ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_litige FORCE ROW LEVEL SECURITY;

CREATE POLICY support_litige_select ON support_litige
    FOR SELECT
    USING (organization_id = {CURRENT_ORG_EXPR} OR {IS_ADMIN_KEYIMMO_EXPR});

CREATE POLICY support_litige_insert ON support_litige
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY support_litige_update ON support_litige
    FOR UPDATE
    USING (organization_id = {CURRENT_ORG_EXPR} OR {IS_ADMIN_KEYIMMO_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR} OR {IS_ADMIN_KEYIMMO_EXPR});
"""

DISABLE_SQL = """
DROP POLICY IF EXISTS support_litige_select ON support_litige;
DROP POLICY IF EXISTS support_litige_insert ON support_litige;
DROP POLICY IF EXISTS support_litige_update ON support_litige;
ALTER TABLE support_litige NO FORCE ROW LEVEL SECURITY;
ALTER TABLE support_litige DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('support', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
