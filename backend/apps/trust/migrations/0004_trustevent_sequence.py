from django.db import migrations, models

# `get_current_status` (apps/trust/repository.py) triait uniquement par
# `-created_at` — deux TrustEvent du même sujet créés dans la même
# transaction (ex: `_advance_existing_reserve`, qui enchaîne
# `nouvelle_inspection` puis `levee`/`rejetee` sans commit intermédiaire)
# peuvent avoir un timestamp trop proche pour être départagés de façon
# fiable, un ordre non déterministe pouvant faire remonter un événement
# intermédiaire au lieu du dernier réel (bug trouvé lors de l'audit qui a
# suivi le ticket 013). `sequence` fournit un critère de tri secondaire
# garanti strictement croissant à l'insertion (séquence Postgres dédiée,
# BIGSERIAL-like), jamais recalculable après coup.
#
# `trust_event` porte le trigger append-only (migration 0002) ET aucune
# policy RLS UPDATE — les deux bloquent normalement tout UPDATE, y compris
# pour le rôle propriétaire de la table (voir CLAUDE.md, section
# "Append-only"). Nécessaire ici pour le backfill des lignes existantes
# (`UPDATE ... SET sequence = ...`, no-op en pratique tant que la table est
# vide, mais correct pour un futur déploiement avec des données réelles) :
# les deux couches sont levées temporairement, puis restaurées avant la fin
# de la transaction de migration — jamais un affaiblissement permanent de
# l'invariant append-only.
SQL = """
ALTER TABLE trust_event NO FORCE ROW LEVEL SECURITY;
ALTER TABLE trust_event DISABLE TRIGGER trust_event_no_update;

CREATE SEQUENCE trust_event_sequence_seq;
ALTER TABLE trust_event ADD COLUMN sequence bigint;
UPDATE trust_event SET sequence = nextval('trust_event_sequence_seq');
ALTER TABLE trust_event ALTER COLUMN sequence SET NOT NULL;
ALTER TABLE trust_event ADD CONSTRAINT trust_event_sequence_key UNIQUE (sequence);
ALTER TABLE trust_event ALTER COLUMN sequence SET DEFAULT nextval('trust_event_sequence_seq');
ALTER SEQUENCE trust_event_sequence_seq OWNED BY trust_event.sequence;

ALTER TABLE trust_event ENABLE TRIGGER trust_event_no_update;
ALTER TABLE trust_event FORCE ROW LEVEL SECURITY;
"""

REVERSE_SQL = """
ALTER TABLE trust_event NO FORCE ROW LEVEL SECURITY;
ALTER TABLE trust_event DISABLE TRIGGER trust_event_no_update;

ALTER TABLE trust_event DROP CONSTRAINT trust_event_sequence_key;
ALTER TABLE trust_event DROP COLUMN sequence;
DROP SEQUENCE IF EXISTS trust_event_sequence_seq;

ALTER TABLE trust_event ENABLE TRIGGER trust_event_no_update;
ALTER TABLE trust_event FORCE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('trust', '0003_alter_trustevent_organization'),
    ]

    operations = [
        migrations.RunSQL(
            sql=SQL,
            reverse_sql=REVERSE_SQL,
            state_operations=[
                migrations.AddField(
                    model_name='trustevent',
                    name='sequence',
                    field=models.BigIntegerField(unique=True, editable=False, default=0),
                    preserve_default=False,
                ),
            ],
        ),
    ]
