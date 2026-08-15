import ast
import inspect
from datetime import timedelta
from unittest import mock

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.services import create_work_declaration
from apps.inspections.models import InspectionOutcome, Reserve
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot
from apps.trust.models import TrustEvent

from . import services
from .models import Task, TaskPriority, TaskStatus, TaskType

PASSWORD = 'strongpass123'


def _register(email, organization_name, role_code='sponsor'):
    """Même technique que les tickets précédents : enregistrement via l'API
    (JWT réel, nécessaire pour que `OrganizationScopeMiddleware` résolve
    `request.organization`), rôle basculé directement en base (pas
    d'endpoint d'invitation, ticket 001 hors scope).
    """
    client = APIClient()
    client.post(
        reverse('register'),
        {'email': email, 'password': PASSWORD, 'organization_name': organization_name},
        format='json',
    )
    token = client.post(reverse('login'), {'email': email, 'password': PASSWORD}, format='json').data['access']
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    user = User.objects.get(email=email)
    organization = Organization.objects.get(name=organization_name)

    set_rls_context(user_id=user.id, organization_id=organization.id)
    if role_code != 'sponsor':
        role, _ = Role.objects.get_or_create(code=role_code, defaults={'label': role_code.capitalize()})
        Membership.objects.filter(user=user, organization=organization).update(role=role)

    return client, organization, user


def _setup_constructeur_org(email, organization_name):
    client, organization, user = _register(email, organization_name, role_code='constructeur')

    program = Program.objects.create(organization=organization, name='Programme')
    asset = Asset.objects.create(organization=organization, program=program, name='Bien')
    lot = Lot.objects.create(organization=organization, asset=asset, name='Lot')
    instantiate_milestones_for_lot(lot)
    milestone = lot.milestones.first()

    declaration = create_work_declaration(organization=organization, milestone=milestone, declared_by=user)

    return client, organization, user, lot, declaration


def _setup_inspecteur(email, organization_name):
    return _register(email, organization_name, role_code='inspecteur')


def _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration):
    response = inspecteur_client.post(
        reverse('inspection-list'),
        {
            'organization': str(constructeur_organization.id),
            'work_declaration': str(declaration.id),
            'outcome': InspectionOutcome.AVEC_RESERVE,
            'note': 'Fissure visible en façade',
        },
        format='json',
    )
    assert response.status_code == 201, response.data
    reserve_id = response.data['opened_reserve']
    assert reserve_id is not None
    return reserve_id


@pytest.mark.django_db
class TestReserveOpenedCreatesTaskForConstructeur:
    """Ticket 006 — scope explicite : un TrustEvent de type « réserve
    ouverte » génère automatiquement une Task pour le constructeur assigné
    au lot.
    """

    def test_opening_a_reserve_creates_a_task_assigned_to_the_declaring_constructeur(self):
        constructeur_client, constructeur_organization, constructeur_user, lot, declaration = (
            _setup_constructeur_org('reservetask-constructeur@example.com', 'Org Reserve Task Constructeur')
        )
        inspecteur_client, _inspecteur_organization, _inspecteur_user = _setup_inspecteur(
            'reservetask-inspecteur@example.com', 'Org Reserve Task Inspecteur',
        )

        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        set_rls_context(user_id=constructeur_user.id, organization_id=constructeur_organization.id)
        task = Task.objects.get(subject_id=reserve_id, source='reserve_opened')

        assert task.type == TaskType.TASK
        assert task.assignee_id == constructeur_user.id
        assert task.organization_id == constructeur_organization.id
        assert task.program_id == lot.asset.program_id
        assert task.status == TaskStatus.PENDING

    def test_reserve_opening_dispatches_a_real_celery_task_not_a_synchronous_call(self):
        """Instruction explicite du ticket : la création de la Task doit
        passer par une vraie tâche Celery (`.delay()`), jamais un appel
        synchrone déguisé en asynchrone. On le prouve en observant l'appel
        à `.delay()` lui-même, indépendamment du mode eager/non-eager
        (qui ne change que CE QUI SE PASSE après l'appel, pas la façon dont
        il est déclenché).
        """
        constructeur_client, constructeur_organization, constructeur_user, lot, declaration = (
            _setup_constructeur_org('reservetask-mock-constructeur@example.com', 'Org Reserve Task Mock')
        )
        inspecteur_client, _inspecteur_organization, _inspecteur_user = _setup_inspecteur(
            'reservetask-mock-inspecteur@example.com', 'Org Reserve Task Mock Inspecteur',
        )

        with mock.patch('apps.tasks.tasks.process_reserve_opened.delay') as mocked_delay:
            response = inspecteur_client.post(
                reverse('inspection-list'),
                {
                    'organization': str(constructeur_organization.id),
                    'work_declaration': str(declaration.id),
                    'outcome': InspectionOutcome.AVEC_RESERVE,
                },
                format='json',
            )
        assert response.status_code == 201

        mocked_delay.assert_called_once()
        _args, kwargs = mocked_delay.call_args
        assert kwargs['organization_id'] == str(constructeur_organization.id)
        assert 'reserve_id' in kwargs


@pytest.mark.django_db
class TestFourTaskTypesAreStructurallyDistinct:
    """Ticket 006 — critère d'acceptation : les 4 types (task/notification/
    alert/exception) sont structurellement distincts, jamais fusionnés dans
    une même liste non typée.
    """

    def _create_one_task_of_each_type(self, organization, assignee, reserve):
        from django.contrib.contenttypes.models import ContentType

        content_type = ContentType.objects.get_for_model(reserve)
        tasks_by_type = {}
        for task_type, label in TaskType.choices:
            tasks_by_type[task_type] = Task.objects.create(
                organization=organization, type=task_type, subject_type=content_type,
                subject_id=reserve.id, assignee=assignee, source='test_fixture',
                label=f'Élément de test — {label}',
            )
        return tasks_by_type

    def test_filtering_my_tasks_by_type_returns_only_that_type(self):
        constructeur_client, constructeur_organization, constructeur_user, lot, declaration = (
            _setup_constructeur_org('fourtypes-constructeur@example.com', 'Org Four Types',
                                     )
        )
        inspecteur_client, _inspecteur_organization, _inspecteur_user = _setup_inspecteur(
            'fourtypes-inspecteur@example.com', 'Org Four Types Inspecteur',
        )
        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        set_rls_context(user_id=constructeur_user.id, organization_id=constructeur_organization.id)
        reserve = Reserve.objects.get(id=reserve_id)
        self._create_one_task_of_each_type(constructeur_organization, constructeur_user, reserve)

        for task_type, _label in TaskType.choices:
            response = constructeur_client.get(reverse('my-tasks'), {'type': task_type})
            assert response.status_code == 200
            returned_types = {row['type'] for row in response.data}
            assert returned_types == {task_type}, (
                f'Filtrer par type={task_type} a renvoyé d\'autres types : {returned_types}'
            )

    def test_task_serializer_always_exposes_the_type_field(self):
        constructeur_client, constructeur_organization, constructeur_user, lot, declaration = (
            _setup_constructeur_org('fourtypes-serializer-constructeur@example.com', 'Org Four Types Serializer')
        )
        inspecteur_client, _inspecteur_organization, _inspecteur_user = _setup_inspecteur(
            'fourtypes-serializer-inspecteur@example.com', 'Org Four Types Serializer Inspecteur',
        )
        _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        response = constructeur_client.get(reverse('my-tasks'))
        assert response.status_code == 200
        assert len(response.data) >= 1
        for row in response.data:
            assert 'type' in row and row['type']


@pytest.mark.django_db
class TestGeneratedLabelNeverAttributesDecisionToKeyimmo:
    """Ticket 006 — critère d'acceptation central, vérifié par une revue du
    texte réellement généré (pas seulement du code) : aucune Task ne doit
    attribuer implicitement une décision à KEYIMMO. Le libellé doit nommer
    l'acteur responsable — ici le constructeur.
    """

    def test_reserve_opened_label_names_the_constructeur_not_keyimmo(self):
        constructeur_client, constructeur_organization, constructeur_user, lot, declaration = (
            _setup_constructeur_org('label-review-constructeur@example.com', 'Org Label Review')
        )
        inspecteur_client, _inspecteur_organization, _inspecteur_user = _setup_inspecteur(
            'label-review-inspecteur@example.com', 'Org Label Review Inspecteur',
        )
        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        set_rls_context(user_id=constructeur_user.id, organization_id=constructeur_organization.id)
        task = Task.objects.get(subject_id=reserve_id, source='reserve_opened')

        label_lower = task.label.lower()
        assert 'keyimmo' not in label_lower, (
            f"Le libellé généré mentionne KEYIMMO comme s'il tranchait : {task.label!r}"
        )
        assert 'constructeur' in label_lower, (
            f"Le libellé généré ne nomme pas l'acteur responsable : {task.label!r}"
        )
        assert constructeur_user.email in task.label


class TestNoTaskLabelGeneratorAttributesDecisionToKeyimmo:
    """Ticket 006 — test de garde générique, sur le modèle de
    `TestNoHardcodedMilestoneNames` (ticket 002, apps/programs/tests.py) :
    contrairement à `TestGeneratedLabelNeverAttributesDecisionToKeyimmo`
    ci-dessus, qui ne vérifie que le texte produit par le seul générateur
    existant aujourd'hui (réserve → constructeur), celui-ci scanne le CODE
    SOURCE de chaque générateur enregistré dans `services.LABEL_GENERATORS`.
    Invariant 25.6 (complément V4.0) : une Task liée à une décision qui
    n'appartient pas à KEYIMMO (ex : une future décision bancaire) ne doit
    jamais laisser entendre que KEYIMMO tranche à la place de l'acteur
    responsable.

    Doit être étendu automatiquement : tout futur ticket qui ajoute un
    nouveau générateur de libellé de Task n'a qu'à l'ajouter à
    `LABEL_GENERATORS` (apps/tasks/services.py) pour être couvert ici, sans
    modifier ce test.
    """

    FORBIDDEN_PHRASES = [
        'keyimmo décide', 'keyimmo décidé', 'keyimmo valide', 'keyimmo validé',
        'keyimmo approuve', 'keyimmo approuvé', 'keyimmo tranche',
    ]

    @staticmethod
    def _source_without_docstring(func):
        """Retire la docstring du code source avant le scan : elle explique
        la règle en PARLANT d'elle (« ne doit jamais suggérer que KEYIMMO
        tranche »), donc un scan naïf du source complet se déclencherait
        lui-même en faux positif sur sa propre documentation — rencontré en
        écrivant ce test contre `_reserve_opened_label`. On isole la
        docstring via `ast` (pas un simple `str.replace`, qui échoue
        silencieusement dès que `inspect.getdoc` renormalise l'indentation)
        pour ne scanner que le code exécutable, dont les vrais templates de
        libellé.
        """
        source = inspect.getsource(func)
        function_node = ast.parse(source).body[0]
        first_statement = function_node.body[0]
        is_docstring = (
            isinstance(first_statement, ast.Expr)
            and isinstance(first_statement.value, ast.Constant)
            and isinstance(first_statement.value.value, str)
        )
        if not is_docstring:
            return source

        lines = source.splitlines()
        del lines[first_statement.lineno - 1:first_statement.end_lineno]
        return '\n'.join(lines)

    def test_no_registered_label_generator_source_attributes_a_decision_to_keyimmo(self):
        assert services.LABEL_GENERATORS, (
            'Aucun générateur de libellé enregistré dans services.LABEL_GENERATORS — '
            'le registre a-t-il été vidé par erreur ?'
        )

        offending = []
        for generator in services.LABEL_GENERATORS:
            source = self._source_without_docstring(generator).lower()
            for phrase in self.FORBIDDEN_PHRASES:
                if phrase in source:
                    offending.append((generator.__name__, phrase))

        assert offending == [], (
            f'Des générateurs de libellé de Task attribuent une décision à KEYIMMO : {offending}'
        )


@pytest.mark.django_db
class TestCompletingTaskNeverDeletesSourceEvent:
    """Ticket 006 — critère d'acceptation : marquer une tâche comme traitée
    ne supprime jamais l'événement source.
    """

    def test_completing_a_task_leaves_the_trust_event_and_reserve_untouched(self):
        constructeur_client, constructeur_organization, constructeur_user, lot, declaration = (
            _setup_constructeur_org('complete-constructeur@example.com', 'Org Complete Task')
        )
        inspecteur_client, _inspecteur_organization, inspecteur_user = _setup_inspecteur(
            'complete-inspecteur@example.com', 'Org Complete Task Inspecteur',
        )
        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        set_rls_context(user_id=constructeur_user.id, organization_id=constructeur_organization.id)
        task = Task.objects.get(subject_id=reserve_id, source='reserve_opened')

        response = constructeur_client.post(reverse('task-complete', args=[task.id]))
        assert response.status_code == 200
        assert response.data['status'] == TaskStatus.DONE

        task.refresh_from_db()
        assert task.status == TaskStatus.DONE
        assert task.completed_at is not None

        # L'événement source et la réserve existent toujours, inchangés.
        opening_event = TrustEvent.objects.get(subject_id=reserve_id, source='ouverte')
        assert opening_event.actor_id == inspecteur_user.id
        assert Reserve.objects.filter(id=reserve_id).exists()

        from apps.inspections.services import get_reserve_status

        reserve = Reserve.objects.get(id=reserve_id)
        assert get_reserve_status(reserve) == 'ouverte'


@pytest.mark.django_db
class TestTasksAppIsOrganizationScoped:
    """Couverture RLS pour `tasks_task`, suivant le pattern établi pour
    chaque nouvelle table de ce projet.
    """

    def test_task_of_another_organization_is_not_visible(self):
        constructeur_client, constructeur_organization, constructeur_user, lot, declaration = (
            _setup_constructeur_org('scoped-constructeur@example.com', 'Org Tasks Scoped Constructeur')
        )
        inspecteur_client, _inspecteur_organization, _inspecteur_user = _setup_inspecteur(
            'scoped-inspecteur@example.com', 'Org Tasks Scoped Inspecteur',
        )
        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        set_rls_context(user_id=constructeur_user.id, organization_id=constructeur_organization.id)
        task = Task.objects.get(subject_id=reserve_id, source='reserve_opened')

        outsider_client, _outsider_organization, _outsider_user = _register(
            'scoped-outsider@example.com', 'Org Tasks Scoped Outsider',
        )
        response = outsider_client.get(reverse('task-detail', args=[task.id]))
        assert response.status_code == 404


@pytest.mark.django_db
class TestPriorityOrdering:
    """Ticket 008 — `?ordering=priority` : ajouté pour que le résumé
    « prochaine action » de HOME (`apps/home`) consomme ce MÊME endpoint
    plutôt que de dupliquer une logique de sélection côté frontend.
    """

    def _create_task(self, organization, assignee, reserve, *, priority, due_date=None, label='Tâche test'):
        from django.contrib.contenttypes.models import ContentType

        return Task.objects.create(
            organization=organization, type=TaskType.TASK,
            subject_type=ContentType.objects.get_for_model(reserve), subject_id=reserve.id,
            assignee=assignee, source='test_fixture', label=label, priority=priority, due_date=due_date,
        )

    def test_ordering_priority_sorts_high_before_normal_before_low(self):
        constructeur_client, constructeur_organization, constructeur_user, lot, declaration = (
            _setup_constructeur_org('priority-constructeur@example.com', 'Org Priority Ordering')
        )
        inspecteur_client, _inspecteur_organization, _inspecteur_user = _setup_inspecteur(
            'priority-inspecteur@example.com', 'Org Priority Ordering Inspecteur',
        )
        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        set_rls_context(user_id=constructeur_user.id, organization_id=constructeur_organization.id)
        reserve = Reserve.objects.get(id=reserve_id)
        low_task = self._create_task(
            constructeur_organization, constructeur_user, reserve,
            priority=TaskPriority.LOW, label='Tâche basse priorité',
        )
        high_task = self._create_task(
            constructeur_organization, constructeur_user, reserve,
            priority=TaskPriority.HIGH, label='Tâche haute priorité',
        )

        response = constructeur_client.get(reverse('my-tasks'), {'ordering': 'priority'})

        assert response.status_code == 200
        ids_in_order = [row['id'] for row in response.data]
        assert ids_in_order.index(str(high_task.id)) < ids_in_order.index(str(low_task.id))

    def test_ordering_priority_breaks_ties_by_soonest_due_date_nulls_last(self):
        constructeur_client, constructeur_organization, constructeur_user, lot, declaration = (
            _setup_constructeur_org('priority-due-constructeur@example.com', 'Org Priority Due Date')
        )
        inspecteur_client, _inspecteur_organization, _inspecteur_user = _setup_inspecteur(
            'priority-due-inspecteur@example.com', 'Org Priority Due Date Inspecteur',
        )
        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        set_rls_context(user_id=constructeur_user.id, organization_id=constructeur_organization.id)
        reserve = Reserve.objects.get(id=reserve_id)
        now = timezone.now()
        far_task = self._create_task(
            constructeur_organization, constructeur_user, reserve, priority=TaskPriority.HIGH,
            due_date=now + timedelta(days=10), label='Échéance lointaine',
        )
        soon_task = self._create_task(
            constructeur_organization, constructeur_user, reserve, priority=TaskPriority.HIGH,
            due_date=now + timedelta(days=1), label='Échéance proche',
        )
        no_due_date_task = self._create_task(
            constructeur_organization, constructeur_user, reserve, priority=TaskPriority.HIGH,
            due_date=None, label='Sans échéance',
        )

        response = constructeur_client.get(reverse('my-tasks'), {'ordering': 'priority'})

        ids_in_order = [row['id'] for row in response.data]
        # Même priorité (haute) pour les 3 : échéance la plus proche en
        # premier, « sans échéance » toujours en dernier (nulls_last).
        assert ids_in_order.index(str(soon_task.id)) < ids_in_order.index(str(far_task.id))
        assert ids_in_order.index(str(far_task.id)) < ids_in_order.index(str(no_due_date_task.id))

    def test_without_the_ordering_param_behavior_is_unchanged(self):
        # Non-régression explicite (ticket 006) : sans `ordering=priority`,
        # le tri par date de création décroissante reste inchangé.
        constructeur_client, constructeur_organization, constructeur_user, lot, declaration = (
            _setup_constructeur_org('priority-default-constructeur@example.com', 'Org Priority Default')
        )
        inspecteur_client, _inspecteur_organization, _inspecteur_user = _setup_inspecteur(
            'priority-default-inspecteur@example.com', 'Org Priority Default Inspecteur',
        )
        reserve_id = _open_reserve_via_inspection(inspecteur_client, constructeur_organization, declaration)

        set_rls_context(user_id=constructeur_user.id, organization_id=constructeur_organization.id)
        reserve = Reserve.objects.get(id=reserve_id)
        older_task = Task.objects.get(subject_id=reserve_id, source='reserve_opened')
        newer_task = self._create_task(
            constructeur_organization, constructeur_user, reserve,
            priority=TaskPriority.LOW, label='Plus récente',
        )

        response = constructeur_client.get(reverse('my-tasks'))

        ids_in_order = [row['id'] for row in response.data]
        assert ids_in_order.index(str(newer_task.id)) < ids_in_order.index(str(older_task.id))
