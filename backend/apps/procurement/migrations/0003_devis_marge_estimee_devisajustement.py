import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('organizations', '0003_seed_senegal_country_pack'),
        ('procurement', '0002_devis_rls'),
    ]

    operations = [
        migrations.AddField(
            model_name='devis',
            name='marge_estimee',
            # Table vide à ce jour (aucun pilote réel n'a encore utilisé
            # apps.procurement) — défaut 0 fourni uniquement pour que cette
            # migration reste rejouable sans prompt interactif, jamais une
            # valeur métier réelle : `DevisCreateSerializer` (ticket 023)
            # exige `marge_estimee` explicitement à chaque création, ce
            # défaut ne sert donc jamais en pratique.
            field=models.DecimalField(max_digits=14, decimal_places=2, default=0),
            preserve_default=False,
        ),
        migrations.CreateModel(
            name='DevisAjustement',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('ecart', models.DecimalField(decimal_places=2, max_digits=14)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                (
                    'created_by',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='devis_ajustements_created', to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'devis',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='ajustements', to='procurement.devis',
                    ),
                ),
                (
                    'organization',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='devis_ajustements', to='organizations.organization',
                    ),
                ),
            ],
            options={
                'db_table': 'procurement_devis_ajustement',
            },
        ),
    ]
