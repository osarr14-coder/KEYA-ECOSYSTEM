from django.db import migrations

# `programs_program_cost` — ticket B-033. Combine deux garanties dans une
# seule migration de suivi, posées dès la conception de ce modèle (pas un
# retrofit après un flake, contrairement à `PricingConfig`, migration
# `0005_pricingconfig_sequence.py`, ticket B-031) :
#
# 1. `sequence` — la colonne existe déjà (migration précédente,
#    `0007_lot_surface_programcost.py`, `CreateModel`), mais sans son
#    `DEFAULT nextval()` côté DB : Django n'a pas de notion de séquence
#    Postgres dédiée dans son ORM, ce `RunSQL` la crée et la câble. Même
#    garantie qu'un `BIGSERIAL` — ordre d'insertion strict, jamais
#    recalculable après coup. `ProgramCost.save()` alimente `sequence`
#    explicitement via `nextval()` (le DEFAULT reste un filet pour tout
#    insert hors ORM).
# 2. RLS — `SELECT`/`INSERT` scopés organisation (comparaison de colonne
#    simple, une seule branche : pas de second acteur cross-organisation
#    comme `Devis.candidate_organization`), **aucune policy `UPDATE`/
#    `DELETE`** — immutabilité, même niveau que `procurement_devis`
#    (migration `0002_devis_rls.py`, ticket 022). `admin_keyimmo` bascule
#    explicitement le contexte RLS vers l'organisation du programme pour
#    créer (`apps.programs.services.create_program_cost`), même schéma que
#    `create_inspection`/`create_devis`.
CURRENT_ORG_EXPR = "current_setting('app.current_organization_id', true)::uuid"

SQL = f"""
CREATE SEQUENCE programs_program_cost_sequence_seq;
ALTER TABLE programs_program_cost ALTER COLUMN sequence SET DEFAULT nextval('programs_program_cost_sequence_seq');
ALTER SEQUENCE programs_program_cost_sequence_seq OWNED BY programs_program_cost.sequence;

ALTER TABLE programs_program_cost ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs_program_cost FORCE ROW LEVEL SECURITY;

CREATE POLICY programs_program_cost_select ON programs_program_cost
    FOR SELECT
    USING (organization_id = {CURRENT_ORG_EXPR});

CREATE POLICY programs_program_cost_insert ON programs_program_cost
    FOR INSERT
    WITH CHECK (organization_id = {CURRENT_ORG_EXPR});
"""

REVERSE_SQL = """
DROP POLICY IF EXISTS programs_program_cost_select ON programs_program_cost;
DROP POLICY IF EXISTS programs_program_cost_insert ON programs_program_cost;
ALTER TABLE programs_program_cost NO FORCE ROW LEVEL SECURITY;
ALTER TABLE programs_program_cost DISABLE ROW LEVEL SECURITY;

ALTER TABLE programs_program_cost ALTER COLUMN sequence DROP DEFAULT;
DROP SEQUENCE IF EXISTS programs_program_cost_sequence_seq;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('programs', '0007_lot_surface_programcost'),
    ]

    operations = [
        migrations.RunSQL(sql=SQL, reverse_sql=REVERSE_SQL),
    ]
