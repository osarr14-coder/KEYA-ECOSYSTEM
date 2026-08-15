from django.db import migrations

# tasks_task porte organization_id — celle de l'assigné (le constructeur),
# donc l'organisation elle-même qui doit pouvoir lire ses propres tâches via
# le contexte RLS normal, résolu par le middleware. Pattern standard, comme
# Program/Asset/Lot (ticket 002), Document/WorkDeclaration/Evidence (ticket
# 004), Inspection/Reserve/ReserveCorrection (ticket 005).
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

ENABLE_SQL = f"""
ALTER TABLE tasks_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks_task FORCE ROW LEVEL SECURITY;

CREATE POLICY tasks_task_scope ON tasks_task
    FOR ALL
    USING (organization_id = {CURRENT_ORG_EXPR})
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""

DISABLE_SQL = """
DROP POLICY IF EXISTS tasks_task_scope ON tasks_task;
ALTER TABLE tasks_task NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks_task DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('inbox_tasks', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
