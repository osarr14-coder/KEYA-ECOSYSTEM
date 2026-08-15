from .models import Milestone, MilestoneTemplate


def get_active_template(country_pack):
    """Le template actif le plus récent pour ce CountryPack. Retourne None
    s'il n'en existe aucun — un lot peut alors être créé sans jalon plutôt
    que d'échouer, le seed garantit qu'un template existe pour Sénégal.
    """
    return (
        MilestoneTemplate.objects.filter(country_pack=country_pack, is_active=True)
        .order_by('-version')
        .first()
    )


def instantiate_milestones_for_lot(lot):
    """Recopie les `MilestoneTemplateStep` du template actif du CountryPack
    du programme du lot vers des `Milestone` — un instantané au moment de la
    création du lot, pas une référence vivante au template (voir docstring
    de `Milestone`). Modifier le template ensuite ne change donc que les
    jalons des lots créés après la modification, jamais ceux déjà créés —
    critère d'acceptation du ticket 002.
    """
    country_pack = lot.asset.program.organization.country_pack
    template = get_active_template(country_pack)
    if template is None:
        return []

    milestones = [
        Milestone(
            organization_id=lot.organization_id,
            lot=lot,
            order=step.order,
            code=step.code,
            label=step.label,
            weight=step.weight,
        )
        for step in template.steps.all()
    ]
    return Milestone.objects.bulk_create(milestones)
