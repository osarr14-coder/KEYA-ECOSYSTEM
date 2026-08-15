import uuid

from django.db import migrations

# Ticket 002 : valeurs de départ du template de jalons pour le Country Pack
# Sénégal — une donnée de seed, jamais une liste codée en dur ailleurs dans
# le code applicatif. (code, label) — l'ordre de la liste fixe `order`.
SENEGAL_STEPS = [
    ('foncier', 'Foncier'),
    ('conception', 'Conception'),
    ('fondations', 'Fondations'),
    ('gros_oeuvre', 'Gros œuvre'),
    ('second_oeuvre', 'Second œuvre'),
    ('finitions', 'Finitions'),
    ('reception', 'Réception'),
    ('livraison', 'Livraison'),
]

SENEGAL_COUNTRY_PACK_CODE = 'SN'
TEMPLATE_VERSION = 1


def seed_template(apps, schema_editor):
    CountryPack = apps.get_model('organizations', 'CountryPack')
    MilestoneTemplate = apps.get_model('programs', 'MilestoneTemplate')
    MilestoneTemplateStep = apps.get_model('programs', 'MilestoneTemplateStep')

    senegal = CountryPack.objects.get(code=SENEGAL_COUNTRY_PACK_CODE)
    template, created = MilestoneTemplate.objects.get_or_create(
        country_pack=senegal,
        version=TEMPLATE_VERSION,
        defaults={'id': uuid.uuid4(), 'is_active': True},
    )
    if not created:
        return

    MilestoneTemplateStep.objects.bulk_create(
        [
            MilestoneTemplateStep(
                id=uuid.uuid4(), template=template, order=index, code=code, label=label,
            )
            for index, (code, label) in enumerate(SENEGAL_STEPS, start=1)
        ],
    )


def remove_template(apps, schema_editor):
    CountryPack = apps.get_model('organizations', 'CountryPack')
    MilestoneTemplate = apps.get_model('programs', 'MilestoneTemplate')

    MilestoneTemplate.objects.filter(
        country_pack__code=SENEGAL_COUNTRY_PACK_CODE, version=TEMPLATE_VERSION,
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('programs', '0002_programs_rls'),
        ('organizations', '0003_seed_senegal_country_pack'),
    ]

    operations = [
        migrations.RunPython(seed_template, reverse_code=remove_template),
    ]
