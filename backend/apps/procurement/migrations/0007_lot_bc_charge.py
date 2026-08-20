import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('organizations', '0003_seed_senegal_country_pack'),
        ('programs', '0008_programcost_sequence_and_rls'),
        ('inspections', '0006_inspectionmission_rls'),
        ('procurement', '0006_lot_ledger_rls'),
    ]

    operations = [
        migrations.CreateModel(
            name='LotBcCharge',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('jalon_type', models.CharField(max_length=50)),
                ('montant', models.DecimalField(decimal_places=2, max_digits=16)),
                ('is_global_reference', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('sequence', models.BigIntegerField(editable=False, unique=True)),
                (
                    'created_by',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='lot_bc_charges_created', to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'lot',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='bc_charges', to='programs.lot',
                    ),
                ),
                (
                    'mission',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='bc_charge', to='inspections.inspectionmission',
                    ),
                ),
                (
                    'organization',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='lot_bc_charges', to='organizations.organization',
                    ),
                ),
            ],
            options={
                'db_table': 'procurement_lot_bc_charge',
            },
        ),
    ]
