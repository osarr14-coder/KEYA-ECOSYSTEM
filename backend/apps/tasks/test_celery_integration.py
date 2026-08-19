"""Test d'intégration contre un vrai worker Celery + un vrai broker Redis —
voir docs/adr/0001-celery-eager-mode.md et
apps/evidence/test_celery_integration.py (même fixture partagée,
conftest.py, réutilisée telle quelle plutôt que redupliquée).
"""

from django.db import transaction

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.services import create_work_declaration
from apps.inspections.models import Inspection, InspectionOutcome, Reserve
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot
from conftest import (
    TASK_RESULT_TIMEOUT_SECONDS,
    ensure_senegal_milestone_template_seeded,
    get_or_create_senegal_country_pack,
    requires_real_redis,
)

from .models import Task
from .tasks import process_reserve_opened


def _build_open_reserve_with_real_commits(organization_name, constructeur_email, inspecteur_email):
    senegal = get_or_create_senegal_country_pack()
    ensure_senegal_milestone_template_seeded()

    with transaction.atomic():
        organization = Organization.objects.create(name=organization_name, country_pack=senegal)
        constructeur = User.objects.create_user(email=constructeur_email, password='pass12345')
        inspecteur = User.objects.create_user(email=inspecteur_email, password='pass12345')

        constructeur_role, _ = Role.objects.get_or_create(
            code='constructeur', defaults={'label': 'Constructeur'},
        )
        set_rls_context(user_id=constructeur.id, organization_id=organization.id)
        Membership.objects.create(user=constructeur, organization=organization, role=constructeur_role)

        program = Program.objects.create(organization=organization, name='Programme')
        asset = Asset.objects.create(organization=organization, program=program, name='Bien')
        lot = Lot.objects.create(organization=organization, asset=asset, name='Lot')
        instantiate_milestones_for_lot(lot)
        milestone = lot.milestones.first()
        declaration = create_work_declaration(
            organization=organization, milestone=milestone, declared_by=constructeur,
        )

        inspection = Inspection.objects.create(
            organization=organization, lot=lot, inspector=inspecteur,
            work_declaration=declaration, outcome=InspectionOutcome.AVEC_RESERVE,
        )
        reserve = Reserve.objects.create(
            organization=organization, lot=lot, opened_by_inspection=inspection,
        )

    return organization, constructeur, inspecteur, reserve


@requires_real_redis
def test_real_worker_creates_task_for_the_declaring_constructeur(real_celery_worker):
    """Preuve bout en bout, contre un vrai worker : la propagation RLS
    explicite (organization_id/actor_user_id, même schéma que
    `apps.evidence.tasks.process_document_media`) permet au worker de lire
    la `Reserve` et d'y créer la `Task` assignée au bon constructeur, sans
    aucune requête HTTP pour lui fournir le contexte.
    """
    organization, constructeur, inspecteur, reserve = _build_open_reserve_with_real_commits(
        'Org Tasks Real Worker', 'realworker-constructeur@example.com', 'realworker-inspecteur@example.com',
    )

    async_result = process_reserve_opened.delay(
        reserve_id=str(reserve.id), organization_id=str(organization.id), actor_user_id=str(inspecteur.id),
    )
    async_result.get(timeout=TASK_RESULT_TIMEOUT_SECONDS)

    with transaction.atomic():
        set_rls_context(organization_id=organization.id)
        task = Task.objects.get(subject_id=reserve.id, source='reserve_opened')
        assert task.assignee_id == constructeur.id
        assert 'constructeur' in task.label.lower()
        assert 'keyimmo' not in task.label.lower()


@requires_real_redis
def test_real_worker_processing_the_same_reserve_twice_never_duplicates_the_task(real_celery_worker):
    """Ticket 017 — la protection tient aussi à travers un VRAI aller-retour
    broker + worker, pas seulement au niveau service (voir
    apps/tasks/tests.py::TestTaskGenerationIsIdempotent, double appel direct
    sans worker, et TestTaskCreationRaceUnderConcurrency, vraie concurrence
    sans worker). `process_reserve_opened.delay(...)` appelée deux fois
    avec les mêmes arguments — la seconde exécution ne doit jamais échouer
    ni créer une seconde Task.
    """
    organization, constructeur, inspecteur, reserve = _build_open_reserve_with_real_commits(
        'Org Tasks Real Worker Idempotent', 'realworker-idem-constructeur@example.com',
        'realworker-idem-inspecteur@example.com',
    )

    first_result = process_reserve_opened.delay(
        reserve_id=str(reserve.id), organization_id=str(organization.id), actor_user_id=str(inspecteur.id),
    )
    first_result.get(timeout=TASK_RESULT_TIMEOUT_SECONDS)

    second_result = process_reserve_opened.delay(
        reserve_id=str(reserve.id), organization_id=str(organization.id), actor_user_id=str(inspecteur.id),
    )
    # Ne doit jamais lever : une seconde exécution doit retrouver la Task
    # déjà créée par la première plutôt que d'échouer sur l'IntegrityError
    # de la contrainte d'unicité, ou d'en créer une seconde.
    second_result.get(timeout=TASK_RESULT_TIMEOUT_SECONDS)

    with transaction.atomic():
        set_rls_context(organization_id=organization.id)
        tasks = list(Task.objects.filter(subject_id=reserve.id, source='reserve_opened'))
        assert len(tasks) == 1
        assert tasks[0].assignee_id == constructeur.id
