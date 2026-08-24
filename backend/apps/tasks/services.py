from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.rls import set_rls_context
from apps.organizations.models import Organization
from apps.programs.models import ProgramRequestStatus

from .models import Task, TaskPriority, TaskStatus, TaskType

RESERVE_OPENED_SOURCE = 'reserve_opened'


def _get_or_create_task(lookup, defaults):
    """Ticket 017 : crée une Task pour ce `(subject_type, subject_id,
    source)` si elle n'existe pas déjà — sûr sous VRAIE concurrence, pas
    seulement en apparence.

    `Task.objects.get_or_create(**lookup, defaults=defaults)` seul ne
    suffirait pas ici, même une fois la contrainte d'unicité posée sur
    `Task` (voir `models.py::Meta.constraints`) : deux transactions peuvent
    toutes deux exécuter le `get()` initial et voir « n'existe pas » AVANT
    qu'aucune des deux n'ait écrit — la contrainte empêche alors le doublon
    en base, mais fait échouer la SECONDE écriture avec une
    `IntegrityError`. Cette fonction rattrape explicitement ce cas : dès
    qu'une `IntegrityError` survient à la création, la ligne qu'on cherchait
    à créer existe forcément déjà (créée par l'autre transaction gagnante
    entre-temps) — on la relit avec un second `get()`, jamais un nouveau
    `create()` en aveugle (qui échouerait à nouveau ou masquerait une vraie
    erreur d'intégrité sans rapport avec cette contrainte).
    """
    try:
        return Task.objects.get(**lookup), False
    except Task.DoesNotExist:
        pass

    try:
        with transaction.atomic():
            return Task.objects.create(**lookup, **defaults), True
    except IntegrityError:
        return Task.objects.get(**lookup), False


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
def _mission_assigned_label(mission, assignee):
    """Nomme explicitement l'inspecteur assigné — cette Task n'annonce
    qu'une affectation déjà décidée par admin_keyimmo (le rôle qui possède
    cette action, ticket 012), jamais une décision d'inspection elle-même
    (ce que l'inspecteur constatera sur le terrain reste entièrement le
    sien) : aucun risque d'attribution implicite à couvrir ici, mais le
    générateur reste soumis au même registre par discipline.
    """
    lot = mission.work_declaration.milestone.lot
    return (
        f'Nouvelle mission — inspection à mener sur « {lot.name} » '
        f'({assignee.email})'
    )


def _devis_ajustement_refuse_label(devis, admin):
    """Ticket 023 — cette Task s'auto-assigne à `admin_keyimmo` (l'acteur
    qui vient de tenter l'ajustement refusé), jamais à un tiers : aucun
    risque d'attribution KEYIMMO à couvrir ici (l'assigné EST l'acteur dont
    c'est la décision), mais le générateur reste soumis au même registre
    par discipline, comme les deux précédents.
    """
    return (
        f'Ajustement refusé — écart au-delà de la marge disponible sur le devis de '
        f'« {devis.candidate_organization.name} » (lot « {devis.lot.name} »)'
    )


def _lot_ledger_margin_negative_label(ledger):
    """Ticket B-036 — cette Task ne fait qu'annoncer un FAIT calculé
    (`get_lot_ledger_margin`), jamais une décision : aucun risque
    d'attribution KEYIMMO à couvrir ici, mais le générateur reste soumis
    au même registre par discipline, comme les trois précédents.
    """
    return f'Marge du grand-livre du lot « {ledger.lot.name} » passée sous zéro — vérification requise'


def _program_request_decided_label(program_request):
    """Ticket B-043 — notifie le PROSPECT (jamais un tiers) de la décision
    prise par `admin_keyimmo` sur sa propre demande. Contrairement aux
    générateurs précédents, KEYIMMO est ici réellement l'auteur de la
    décision (`decide_program_request`, ticket B-042) : l'énoncer au passé
    composé ("a été acceptée/refusée") est un FAIT sur la demande, jamais
    une formulation couverte par les phrases interdites du test de garde
    (« keyimmo décide/valide/approuve/tranche ») — vérifié explicitement à
    l'écriture de ce générateur, pas seulement par convention.
    """
    if program_request.status == ProgramRequestStatus.ACCEPTEE:
        return (
            'Votre demande de programme sur mesure a été acceptée — '
            'KEYIMMO prépare la création de votre programme.'
        )
    return 'Votre demande de programme sur mesure a été refusée.'


LABEL_GENERATORS = [
    _reserve_opened_label,
    _mission_assigned_label,
    _devis_ajustement_refuse_label,
    _lot_ledger_margin_negative_label,
    _program_request_decided_label,
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

    lookup = {
        'subject_type': ContentType.objects.get_for_model(reserve),
        'subject_id': reserve.id,
        'source': RESERVE_OPENED_SOURCE,
    }
    defaults = {
        'organization': reserve.organization,
        'type': TaskType.TASK,
        'program': reserve.lot.asset.program,
        'assignee': assignee,
        'label': _reserve_opened_label(reserve, assignee),
        'priority': TaskPriority.NORMAL,
    }
    task, _created = _get_or_create_task(lookup, defaults)
    return task


MISSION_ASSIGNED_SOURCE = 'mission_assigned'


def create_task_for_mission_assigned(mission):
    """Logique métier pure, séparée de la tâche Celery
    (`apps/tasks/tasks.py::process_mission_assigned`) qui l'appelle sous le
    bon contexte RLS — même schéma que `create_task_for_reserve_opened`.

    `Task.organization` = celle de la mission (l'organisation CIBLE, pas
    celle de l'inspecteur assigné, qui n'en est jamais membre par
    construction — règle d'indépendance, ticket 005). Limite connue,
    assumée : `GET /api/me/tasks/` reste scopé par l'organisation ACTIVE de
    l'inspecteur (RLS standard sur `tasks_task`, jamais élargie par ce
    ticket — hors scope), donc cette Task n'y apparaîtra pas pour lui tant
    que son organisation active reste la sienne. Le vrai chemin de
    visibilité de la mission pour l'inspecteur est
    `GET /api/control/missions/` (ticket 012) ; cette Task ne sert que de
    trace/notification opérationnelle, pas de source de vérité.
    """
    assignee = mission.assigned_inspector

    lookup = {
        'subject_type': ContentType.objects.get_for_model(mission),
        'subject_id': mission.id,
        'source': MISSION_ASSIGNED_SOURCE,
    }
    defaults = {
        'organization': mission.organization,
        'type': TaskType.TASK,
        'program': mission.work_declaration.milestone.lot.asset.program,
        'assignee': assignee,
        'label': _mission_assigned_label(mission, assignee),
        'priority': TaskPriority.NORMAL,
    }
    task, _created = _get_or_create_task(lookup, defaults)
    return task


DEVIS_AJUSTEMENT_REFUSE_SOURCE = 'devis_ajustement_refuse'


def create_task_for_devis_ajustement_refuse(devis, admin):
    """Ticket 023 : notifie `admin_keyimmo` (l'acteur qui vient de tenter
    l'ajustement) qu'un ajustement a été refusé — écart au-delà de la marge
    disponible sur le devis verrouillé. Contrairement aux deux générateurs
    précédents (assignés à un AUTRE acteur que l'appelant), celui-ci
    s'auto-assigne : `assignee=admin` est déjà connu du contexte de la
    requête, aucun résolveur à écrire (contrairement à
    `resolve_constructeur_for_reserve`).

    Appelée SYNCHRONEMENT depuis `apps.procurement.services.create_ajustement`
    — PAS via une tâche Celery/`.delay()` comme les deux générateurs
    précédents. Déviation documentée et assumée : le refus a lieu DANS la
    même requête que la tentative de l'admin (qui reçoit déjà un 409
    immédiat en réponse) — cette Task n'est qu'une trace durable de
    l'événement dans son inbox, pas un traitement qui bénéficierait d'un
    découplage réseau comme la compression média (ticket 004) ou la
    notification d'un AUTRE acteur (ticket 006), qui doivent survivre
    indépendamment de la requête qui les déclenche.

    `_get_or_create_task` (déduplication par `(subject_type, subject_id,
    source)`, ticket 017) évite qu'une seconde tentative refusée sur le
    MÊME devis ne duplique l'alerte tant que la première reste `pending`.
    """
    lookup = {
        'subject_type': ContentType.objects.get_for_model(devis),
        'subject_id': devis.id,
        'source': DEVIS_AJUSTEMENT_REFUSE_SOURCE,
    }
    defaults = {
        'organization': devis.organization,
        'type': TaskType.ALERT,
        'program': devis.lot.asset.program,
        'assignee': admin,
        'label': _devis_ajustement_refuse_label(devis, admin),
        'priority': TaskPriority.HIGH,
    }
    task, _created = _get_or_create_task(lookup, defaults)
    return task


LOT_LEDGER_MARGIN_NEGATIVE_SOURCE = 'lot_ledger_margin_negative'


def create_task_for_lot_ledger_margin_negative(ledger, actor):
    """Ticket B-036 : notifie `admin_keyimmo` que la marge disponible du
    grand-livre d'un lot vient de passer sous zéro, suite à la création
    d'une charge bureau de contrôle (`apps.procurement.services.
    record_bc_charge_for_mission`). Réutilise EXACTEMENT le même schéma
    que `create_task_for_devis_ajustement_refuse` (ticket 024) :
    `subject` = le `LotLedger` (la marge du GRAND-LIVRE est en alerte, pas
    la charge ni le lot), auto-assignée à `actor` (l'admin qui vient de
    créer la mission qui a fait basculer la marge).

    Appelée SYNCHRONEMENT depuis `record_bc_charge_for_mission`, sous la
    MÊME bascule RLS que la mission — jamais via `.delay()`, même
    raisonnement que `create_task_for_devis_ajustement_refuse` (trace
    durable d'un événement déjà survenu DANS la requête courante, pas un
    traitement à découpler).

    **Limite héritée de `_get_or_create_task` (ticket 017), pas nouvelle
    ici** : la contrainte `UniqueConstraint` sur `(subject_type,
    subject_id, source)` n'est pas scopée par statut — une fois une
    première alerte créée puis marquée `DONE`, une DEUXIÈME dérive de
    marge ultérieure sur le MÊME grand-livre ne génère PAS de nouvelle
    alerte (`_get_or_create_task` retrouve l'ancienne, déjà traitée,
    silencieusement). Comportement déjà présent pour `DevisAjustement`
    refusé, pas une régression introduite par ce ticket.
    """
    lookup = {
        'subject_type': ContentType.objects.get_for_model(ledger),
        'subject_id': ledger.id,
        'source': LOT_LEDGER_MARGIN_NEGATIVE_SOURCE,
    }
    defaults = {
        'organization': ledger.organization,
        'type': TaskType.ALERT,
        'program': ledger.lot.asset.program,
        'assignee': actor,
        'label': _lot_ledger_margin_negative_label(ledger),
        'priority': TaskPriority.HIGH,
    }
    task, _created = _get_or_create_task(lookup, defaults)
    return task


PROGRAM_REQUEST_DECIDED_SOURCE = 'program_request_decided'


def create_task_for_program_request_decided(program_request):
    """Ticket B-043 : notifie le PROSPECT (`program_request.requested_by`)
    dès que `admin_keyimmo` accepte ou refuse sa demande de programme sur
    mesure (`apps.programs.services.decide_program_request`, ticket B-042).
    `type=TaskType.NOTIFICATION` — premier générateur à utiliser ce type
    des 4 prévus par la doctrine (ticket 006, `TaskType`) : les trois
    précédents sont tous des `TASK`/`ALERT` (une action attendue), celui-ci
    n'annonce qu'un FAIT déjà acté, rien à traiter côté prospect.

    Appelée SYNCHRONEMENT depuis `decide_program_request`, DANS le même
    bloc `transaction.atomic()`, APRÈS la bascule RLS vers l'organisation
    CIBLE (celle du prospect) et AVANT sa restauration vers celle de
    l'admin — indispensable : `tasks_task` n'a qu'une policy RLS mono-
    organisation (`organization_id = current_org`, aucune branche
    cross-org comme `Litige`, ticket B-041), donc créer cette Task sous le
    contexte RLS de l'ADMIN échouerait sa `WITH CHECK`. Même raisonnement
    que `create_task_for_devis_ajustement_refuse`/
    `create_task_for_lot_ledger_margin_negative` : trace synchrone d'un
    événement qui vient de survenir DANS la requête courante, pas un
    traitement à découpler par Celery.

    `_get_or_create_task` (dédup par `(subject_type, subject_id, source)`,
    ticket 017) : une demande ne peut être décidée qu'une fois dans le
    parcours normal (les boutons Accepter/Refuser disparaissent après la
    première décision côté écran, ticket F-058) — cette Task n'est donc
    créée qu'une seule fois par demande.
    """
    lookup = {
        'subject_type': ContentType.objects.get_for_model(program_request),
        'subject_id': program_request.id,
        'source': PROGRAM_REQUEST_DECIDED_SOURCE,
    }
    defaults = {
        'organization': program_request.organization,
        'type': TaskType.NOTIFICATION,
        'program': program_request.program,
        'assignee': program_request.requested_by,
        'label': _program_request_decided_label(program_request),
        'priority': TaskPriority.NORMAL,
    }
    task, _created = _get_or_create_task(lookup, defaults)
    return task


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


def list_my_tasks_across_organizations(*, user, caller_organization_id, status=None):
    """`GET /api/tasks/admin-inbox/` (ticket B-044) et `GET /api/tasks/
    inspector-inbox/` (ticket B-045) — deux générateurs de `Task` posent
    `organization` = celle du sujet CIBLE, jamais celle de l'appelant :
    `create_task_for_devis_ajustement_refuse`/`create_task_for_lot_
    ledger_margin_negative` (tickets 023/B-036, assignee=admin_keyimmo,
    organisation = devis/grand-livre) et `create_task_for_mission_
    assigned` (ticket 012, assignee=inspecteur, organisation = mission —
    l'inspecteur n'en est jamais membre, règle d'indépendance, ticket
    005). Ces Task sont donc invisibles via `MyTasksView`
    (`assignee=request.user`, mais RLS `tasks_task` mono-organisation
    filtre la ligne AVANT que le filtre applicatif ne s'applique, tant
    que l'organisation active de l'appelant ne correspond pas).

    Boucle de bascule RLS organisation par organisation — EXACTEMENT le
    même mécanisme que `apps.programs.services.list_program_requests_as_
    admin` (ticket B-042) et `apps.procurement.services._search_lots_by_
    name_as_admin` (ticket B-028/B-037) — jamais une policy RLS large
    (piège déjà rencontré et corrigé, migration
    `0009_lot_admin_keyimmo_select.py`). Généralisée depuis `list_my_
    tasks_as_admin` (B-044, renommée ici) : la boucle est STRICTEMENT
    identique quel que soit le rôle appelant, seul `assignee=user`
    change — pas de second mécanisme dupliqué pour le même problème sur
    la même table. Filtré par `assignee=user` : CET utilisateur voit SES
    propres tâches cross-org, jamais celles d'un autre — même
    granularité que `MyTasksView`. Volume attendu faible (alertes/
    notifications opérationnelles, pas une recherche déclenchée à chaque
    frappe clavier) : aucun plafond `MAX_SEARCH_RESULTS` ici, même
    raisonnement que `list_program_requests_as_admin`.
    """
    results = []
    organization_ids = list(Organization.objects.values_list('id', flat=True))
    try:
        for organization_id in organization_ids:
            set_rls_context(organization_id=organization_id)
            queryset = Task.objects.filter(assignee=user)
            if status:
                queryset = queryset.filter(status=status)
            results.extend(queryset)
    finally:
        set_rls_context(organization_id=caller_organization_id)
    return results


def complete_task_across_organizations(*, caller_organization_id, target_organization_id, task_id):
    """`POST /api/tasks/{id}/admin-complete/?organization_id=<id>`
    (ticket B-044) et `POST /api/tasks/{id}/inspector-complete/
    ?organization_id=<id>` (ticket B-045). Même bascule RLS explicite
    que `apps.programs.services.decide_program_request` (organisation
    CIBLE fournie par l'appelant) : récupère la tâche PAR cette
    organisation, puis délègue à `complete_task` (aucune duplication de
    logique — même fonction que le chemin non cross-org,
    `TaskViewSet.complete`). Généralisée depuis `complete_task_as_admin`
    (B-044, renommée ici) — voir `list_my_tasks_across_organizations`
    ci-dessus pour le raisonnement.
    """
    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            task = Task.objects.filter(id=task_id, organization_id=target_organization_id).first()
            if task is None:
                raise ValidationError({'task': 'Tâche introuvable.'})
            complete_task(task)
        finally:
            set_rls_context(organization_id=caller_organization_id)
    return task
