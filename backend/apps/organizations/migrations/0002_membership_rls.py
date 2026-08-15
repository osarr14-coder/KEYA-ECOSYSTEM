from django.db import migrations

# `organizations_membership` est la première table scopée par organisation :
# elle démontre le mécanisme RLS que toute future table `organization_id`
# devra reproduire (voir CLAUDE.md, section RLS multi-tenant).
#
# SELECT : uniquement ses propres lignes de membership (`user_id` = moi),
# jamais via `organization_id` = organisation active. Ce n'est PAS un
# raccourci temporaire : `app.current_organization_id` est posé par le
# middleware à partir d'une requête cliente (potentiellement forgeable si un
# bug applicatif venait à mal le valider), alors que `app.current_user_id`
# vient de l'identité JWT vérifiée. Une policy qui accorderait la lecture de
# TOUTE ligne de l'organisation active reviendrait à faire confiance à cette
# valeur — exactement le contournement que le ticket 001 interdit
# explicitement (testé par
# test_select_hides_foreign_org_membership_despite_forged_organization_id).
# Suffisant pour GET /me, qui n'a besoin que de ses propres memberships ;
# "lister les membres de mon organisation" est une capacité future hors
# scope de ce ticket, à traiter avec sa propre policy le jour venu.
#
# INSERT/UPDATE/DELETE : uniquement dans l'organisation active de la requête,
# jamais via la branche "c'est ma propre ligne" — sinon un utilisateur
# pourrait s'auto-assigner une organisation en forgeant organization_id dans
# le corps de la requête. Le seul cas où l'organisation active peut être
# "la mienne alors qu'elle vient d'être créée" est l'inscription, où le
# service pose explicitement ce contexte avant l'INSERT (voir
# apps/accounts/serializers.py RegisterSerializer.create).
CURRENT_USER_EXPR = "current_setting('app.current_user_id', true)::uuid"
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

ENABLE_RLS_SQL = f"""
ALTER TABLE organizations_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations_membership FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_select ON organizations_membership
    FOR SELECT
    USING (user_id = {CURRENT_USER_EXPR});

CREATE POLICY membership_insert ON organizations_membership
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY membership_update ON organizations_membership
    FOR UPDATE
    USING (organization_id = {CURRENT_ORG_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY membership_delete ON organizations_membership
    FOR DELETE
    USING (organization_id = {CURRENT_ORG_EXPR});
"""

DISABLE_RLS_SQL = """
DROP POLICY IF EXISTS membership_select ON organizations_membership;
DROP POLICY IF EXISTS membership_insert ON organizations_membership;
DROP POLICY IF EXISTS membership_update ON organizations_membership;
DROP POLICY IF EXISTS membership_delete ON organizations_membership;
ALTER TABLE organizations_membership NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organizations_membership DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('organizations', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
