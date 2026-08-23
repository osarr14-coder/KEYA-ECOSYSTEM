from django.db import migrations

# Ticket B-042 — même pattern que apps/programs/migrations/0002_programs_rls.py :
# `programs_program_request` porte un `organization_id` (l'organisation du
# DEMANDEUR, jamais dénormalisée d'un `Program` puisqu'aucun n'existe encore
# au moment de la demande) — cas simple du pattern documenté dans CLAUDE.md,
# sans branche "ma propre ligne". Aucune policy SELECT admin_keyimmo large :
# la lecture cross-organisation d'admin_keyimmo (`GET /api/programs/
# requests/`) passe par une boucle de bascule RLS organisation par
# organisation (apps.programs.services.list_program_requests_as_admin),
# EXACTEMENT le même mécanisme déjà établi par
# apps.procurement.services._search_lots_by_name_as_admin (ticket B-028/
# B-037) — jamais une policy large, piège déjà rencontré et corrigé au
# ticket B-041 (voir migration 0009_lot_admin_keyimmo_select.py).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

TABLE = 'programs_program_request'

ENABLE_SQL = f"""
ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY;

CREATE POLICY {TABLE}_scope ON {TABLE}
    FOR ALL
    USING (organization_id = {CURRENT_ORG_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""

DISABLE_SQL = f"""
DROP POLICY IF EXISTS {TABLE}_scope ON {TABLE};
ALTER TABLE {TABLE} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {TABLE} DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('programs', '0010_lot_commercial_fields_and_program_request'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
