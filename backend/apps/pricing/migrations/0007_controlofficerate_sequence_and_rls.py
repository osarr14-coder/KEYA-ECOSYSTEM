from django.db import migrations

# `pricing_control_office_rate` — ticket B-034. Combine deux garanties dans
# une seule migration de suivi, posées dès la conception de ce modèle (pas
# un retrofit après un flake, contrairement à `PricingConfig`, migration
# `0005_pricingconfig_sequence.py`, ticket B-031) :
#
# 1. `sequence` — la colonne existe déjà (migration précédente,
#    `0006_controlofficerate_and_more.py`, `CreateModel`), mais sans son
#    `DEFAULT nextval()` côté DB. Même garantie qu'un `BIGSERIAL` — ordre
#    d'insertion strict, jamais recalculable après coup.
#    `ControlOfficeRate.save()` alimente `sequence` explicitement via
#    `nextval()` (le DEFAULT reste un filet pour tout insert hors ORM).
# 2. RLS — même schéma que `pricing_pricingconfig`
#    (`0002_pricingconfig_rls.py`, ticket 025) : `SELECT`/`INSERT`
#    permissifs (aucune colonne `organization_id` naturelle — donnée de
#    référence par `CountryPack`, pas par organisation), **aucune policy
#    `UPDATE`/`DELETE`** — immutabilité. Lecture réservée à `admin_keyimmo` :
#    permission DRF (`IsAdminKeyimmo`), jamais une policy RLS.
SQL = """
CREATE SEQUENCE pricing_control_office_rate_sequence_seq;
ALTER TABLE pricing_control_office_rate ALTER COLUMN sequence SET DEFAULT nextval('pricing_control_office_rate_sequence_seq');
ALTER SEQUENCE pricing_control_office_rate_sequence_seq OWNED BY pricing_control_office_rate.sequence;

ALTER TABLE pricing_control_office_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_control_office_rate FORCE ROW LEVEL SECURITY;

CREATE POLICY pricing_control_office_rate_select ON pricing_control_office_rate
    FOR SELECT
    USING (true);

CREATE POLICY pricing_control_office_rate_insert ON pricing_control_office_rate
    FOR INSERT
    WITH CHECK (true);
"""

REVERSE_SQL = """
DROP POLICY IF EXISTS pricing_control_office_rate_select ON pricing_control_office_rate;
DROP POLICY IF EXISTS pricing_control_office_rate_insert ON pricing_control_office_rate;
ALTER TABLE pricing_control_office_rate NO FORCE ROW LEVEL SECURITY;
ALTER TABLE pricing_control_office_rate DISABLE ROW LEVEL SECURITY;

ALTER TABLE pricing_control_office_rate ALTER COLUMN sequence DROP DEFAULT;
DROP SEQUENCE IF EXISTS pricing_control_office_rate_sequence_seq;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0006_controlofficerate_and_more'),
    ]

    operations = [
        migrations.RunSQL(sql=SQL, reverse_sql=REVERSE_SQL),
    ]
