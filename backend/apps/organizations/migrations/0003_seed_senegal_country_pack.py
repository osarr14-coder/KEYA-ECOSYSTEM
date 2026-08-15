from django.db import migrations

# Ticket 001 : CountryPack existe comme table séparée dès ce ticket, même
# avec une seule ligne — jamais codée en dur dans le code applicatif.
SENEGAL_CODE = 'SN'
SENEGAL_LABEL = 'Sénégal'


def seed_senegal(apps, schema_editor):
    CountryPack = apps.get_model('organizations', 'CountryPack')
    CountryPack.objects.get_or_create(code=SENEGAL_CODE, defaults={'label': SENEGAL_LABEL})


def remove_senegal(apps, schema_editor):
    CountryPack = apps.get_model('organizations', 'CountryPack')
    CountryPack.objects.filter(code=SENEGAL_CODE).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('organizations', '0002_membership_rls'),
    ]

    operations = [
        migrations.RunPython(seed_senegal, reverse_code=remove_senegal),
    ]
