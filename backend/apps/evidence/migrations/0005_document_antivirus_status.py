# PO-2026-09-30-07 (T15) — statut antivirus de chaque document. Les
# documents existants n'ont jamais été analysés : « non analysé ».

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("evidence", "0004_required_pieces"),
    ]

    operations = [
        migrations.AddField(
            model_name="document",
            name="antivirus_status",
            field=models.CharField(
                choices=[("analyse", "Analysé"), ("non_analyse", "Non analysé"), ("infecte", "Détecté — non servi")],
                default="non_analyse",
                max_length=20,
            ),
        ),
    ]
