from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.rls import set_rls_context

from .models import Lot, Milestone, MilestoneTemplate, Program, ProgramCost, ProgramCostRepartitionMethod

# Ordre canonique "plus récent d'abord" pour ProgramCost — même tuple que
# apps.trust.repository/apps.pricing.services (LATEST_FIRST_ORDERING,
# tickets 013 bis/B-031) : sequence construit dès la conception de ce
# modèle, pas retrofit après un flake.
LATEST_FIRST_ORDERING = ('-created_at', '-sequence')


class LotMissingSurfaceError(Exception):
    """Ticket B-033 — la méthode `prorata_surface` exige que TOUS les lots
    du programme aient une `surface` renseignée. Refusé explicitement,
    jamais un partage silencieux à zéro pour les lots sans surface.
    """


class NoProgramCostError(Exception):
    """Ticket B-033 — aucun `ProgramCost` n'existe encore pour ce
    programme : rien à répartir. Même famille que
    `apps.pricing.services`/`apps.procurement.services.NoPricingConfigError`
    — 409, pas une réponse vide silencieuse.
    """


def create_program_cost(
    *, admin, admin_organization_id, target_organization_id, program_id,
    foncier_total, be_total, repartition_method, justification,
):
    """Point d'entrée unique pour créer une révision `ProgramCost` — ticket
    B-033. L'appelant (`apps.programs.views.ProgramCostCreateView`) a déjà
    vérifié que `admin` détient `admin_keyimmo` (`IsAdminKeyimmo`, ticket
    011) ; cette fonction ne revérifie pas ce rôle.

    `target_organization_id` (l'organisation du PROGRAMME) est fourni
    EXPLICITEMENT par l'appelant — même schéma de bascule RLS que
    `create_devis`/`create_inspection` (tickets 022/005) : lire `Program`
    sous le contexte RLS de l'admin échouerait silencieusement (résultat
    vide, jamais une exception) s'il n'est pas membre de cette
    organisation — `target_organization_id` ne peut donc pas être dérivé
    APRÈS coup depuis `program_id` seul.
    """
    if not justification or not justification.strip():
        raise ValidationError({'justification': 'Une justification est requise.'})
    if repartition_method not in ProgramCostRepartitionMethod.values:
        raise ValidationError({'repartition_method': 'Méthode de répartition invalide.'})

    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            program = Program.objects.filter(id=program_id, organization_id=target_organization_id).first()
            if program is None:
                raise ValidationError({'program': 'Programme introuvable.'})

            program_cost = ProgramCost.objects.create(
                organization_id=target_organization_id,
                program=program,
                foncier_total=foncier_total,
                be_total=be_total,
                repartition_method=repartition_method,
                justification=justification,
                created_by=admin,
            )
        finally:
            set_rls_context(organization_id=admin_organization_id)
    return program_cost


def get_current_program_cost(*, admin_organization_id, target_organization_id, program_id):
    """Le `ProgramCost` ACTUEL (dernier créé, `LATEST_FIRST_ORDERING`) pour
    ce programme — `None` si aucun n'existe encore.
    """
    set_rls_context(organization_id=target_organization_id)
    try:
        return ProgramCost.objects.filter(program_id=program_id).order_by(*LATEST_FIRST_ORDERING).first()
    finally:
        set_rls_context(organization_id=admin_organization_id)


def get_program_cost_history(*, admin_organization_id, target_organization_id, program_id):
    """Historique COMPLET des révisions de ce programme, du plus ancien au
    plus récent — tie-break `sequence` symétrique à `LATEST_FIRST_ORDERING`.
    """
    set_rls_context(organization_id=target_organization_id)
    try:
        return list(
            ProgramCost.objects.filter(program_id=program_id).order_by('created_at', 'sequence'),
        )
    finally:
        set_rls_context(organization_id=admin_organization_id)


def compute_lot_repartition(*, admin_organization_id, target_organization_id, program_id):
    """Répartition de `foncier_total`/`be_total` (dernier `ProgramCost` du
    programme) entre tous ses lots — calculée À LA VOLÉE, jamais stockée
    (décision de conception, ticket B-033). Retourne une LISTE indexée par
    lot, `[{'lot': Lot, 'foncier_lot': Decimal, 'be_lot': Decimal}, ...]` —
    jamais un objet agrégé (précision explicite de l'utilisateur).

    **Arrondi — dérive assumée, pas de correction du reste** (décision E) :
    `ROUND_HALF_UP` par lot, comme `apps.procurement.services.
    _derive_marge_estimee` (ticket 026) — la somme des parts arrondies peut
    ne pas retomber exactement sur le total au centime près. Aucun
    mouvement de fonds réel n'existe dans ce projet ; dette explicite pour
    un futur ticket si un vrai mouvement de fonds l'exige.
    """
    set_rls_context(organization_id=target_organization_id)
    try:
        current = ProgramCost.objects.filter(program_id=program_id).order_by(*LATEST_FIRST_ORDERING).first()
        if current is None:
            raise NoProgramCostError('Aucun ProgramCost enregistré pour ce programme — rien à répartir.')

        lots = list(Lot.objects.filter(asset__program_id=program_id))
        if not lots:
            return []

        if current.repartition_method == ProgramCostRepartitionMethod.PRORATA_SURFACE:
            lots_without_surface = [lot for lot in lots if lot.surface is None]
            if lots_without_surface:
                missing_names = ', '.join(lot.name for lot in lots_without_surface)
                raise LotMissingSurfaceError(
                    f"Répartition « prorata_surface » impossible : lot(s) sans surface renseignée : "
                    f"{missing_names}.",
                )
            total_surface = sum(lot.surface for lot in lots)
            shares = {lot.id: lot.surface / total_surface for lot in lots}
        else:
            equal_share = Decimal('1') / Decimal(len(lots))
            shares = {lot.id: equal_share for lot in lots}

        return [
            {
                'lot': lot,
                'foncier_lot': (current.foncier_total * shares[lot.id]).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                ),
                'be_lot': (current.be_total * shares[lot.id]).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                ),
            }
            for lot in lots
        ]
    finally:
        set_rls_context(organization_id=admin_organization_id)


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
