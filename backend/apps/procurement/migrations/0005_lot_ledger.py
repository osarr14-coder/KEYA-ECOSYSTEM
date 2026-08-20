import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('organizations', '0003_seed_senegal_country_pack'),
        ('programs', '0008_programcost_sequence_and_rls'),
        ('procurement', '0004_devisajustement_rls'),
    ]

    operations = [
        migrations.CreateModel(
            name='LotLedger',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('prix_client', models.DecimalField(decimal_places=2, max_digits=16)),
                ('foncier_alloue', models.DecimalField(decimal_places=2, max_digits=16)),
                ('be_alloue', models.DecimalField(decimal_places=2, max_digits=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                (
                    'created_by',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='lot_ledgers_created', to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'lot',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='ledger', to='programs.lot',
                    ),
                ),
                (
                    'organization',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='lot_ledgers', to='organizations.organization',
                    ),
                ),
            ],
            options={
                'db_table': 'procurement_lot_ledger',
            },
        ),
    ]
