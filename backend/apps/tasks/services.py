from django.contrib.contenttypes.models import ContentType
from django.utils import timezone

from .models import Task, TaskPriority, TaskStatus, TaskType

RESERVE_OPENED_SOURCE = 'reserve_opened'


def resolve_constructeur_for_reserve(reserve):
    """Le constructeur assigné au lot n'est stocké nulle part explicitement
    (aucun champ « assigné » sur `Lot`, ticket 002) — il se déduit de la
    déclaration de travaux à l'origine de l'inspection qui a ouvert cette
    réserve (`WorkDeclaration.declared_by`), directement ou via l'`Evidence`
    inspectée. Retourne `None` si, pour une raison quelconque, aucune
    déclaration n'est trouvée — la Task n'est alors pas créée (voir
    `create_task_for_reserve_opened`) plutôt que d'assigner à quelqu'un au
    hasard.
    """
    inspection = reserve.opened_by_inspection
    work_declaration = inspection.work_declaration
    if work_declaration is None and inspection.evidence is not None:
        work_declaration = inspection.evidence.work_declaration
    return work_declaration.declared_by if work_declaration else None


def _reserve_opened_label(reserve, assignee):
    """Nomme explicitement le constructeur comme responsable de l'action à
    mener — jamais KEYIMMO. Critère d'acceptation central du ticket 006 :
    aucune Task générée par le système ne doit suggérer que KEYIMMO tranche
    à la place de l'acteur compétent.
    """
    return (
        f'Réserve ouverte sur le lot « {reserve.lot.name} » — correction attendue '
        f'du constructeur ({assignee.email})'
    )


# Invariant 25.6 (complément V4.0) : toute Task liée à une décision qui
# n'appartient pas à KEYIMMO (ex : une future décision bancaire, notariale,
# ou d'une autre autorité) doit toujours nommer l'acteur RÉELLEMENT
# responsable dans son libellé — jamais suggérer que KEYIMMO tranche à sa
# place. Tout nouveau générateur de libellé de Task (ce ticket n'en compte
# qu'un, réserve → constructeur) doit être ajouté à LABEL_GENERATORS
# ci-dessous : c'est ce qui le fait couvrir par le test de garde
# `TestNoTaskLabelGeneratorAttributesDecisionToKeyimmo` (apps/tasks/tests.py,
# ticket 006), qui scanne le CODE SOURCE de chaque générateur enregistré —
# pas seulement le texte produit par celui qui existe aujourd'hui.
LABEL_GENERATORS = [
    _reserve_opened_label,
]


def create_task_for_reserve_opened(reserve):
    """Logique métier pure, séparée de la tâche Celery
    (`apps/tasks/tasks.py::process_reserve_opened`) qui l'appelle sous le
    bon contexte RLS — testable directement, sans worker, comme tout
    `services.py` de ce projet.
    """
    assignee = resolve_constructeur_for_reserve(reserve)
    if assignee is None:
        return None

    return Task.objects.create(
        organization=reserve.organization,
        type=TaskType.TASK,
        subject_type=ContentType.objects.get_for_model(reserve),
        subject_id=reserve.id,
        program=reserve.lot.asset.program,
        assignee=assignee,
        source=RESERVE_OPENED_SOURCE,
        label=_reserve_opened_label(reserve, assignee),
        priority=TaskPriority.NORMAL,
    )


def complete_task(task):
    """Marquer une Task traitée ne touche jamais à son sujet (le
    `TrustEvent`/`Reserve` qui l'a déclenchée) — c'est un fait sur LA TASK
    elle-même, jamais une réécriture de l'historique métier. Critère
    d'acceptation ticket 006.
    """
    task.status = TaskStatus.DONE
    task.completed_at = timezone.now()
    task.save(update_fields=['status', 'completed_at'])
    return task
