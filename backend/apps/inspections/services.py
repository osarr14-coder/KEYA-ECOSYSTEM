from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.rls import set_rls_context
from apps.evidence.models import Evidence, WorkDeclaration
from apps.organizations.models import Membership, Organization
from apps.trust import repository as trust_repository
from apps.trust.models import TrustLevel

from .models import Inspection, InspectionMission, InspectionOutcome, Reserve, ReserveCorrection
from .permissions import INSPECTEUR_ROLE_CODE


class IndependenceRuleViolation(Exception):
    """L'inspecteur appartient à la même organisation que le lot inspecté —
    interdit par la règle d'indépendance du contrôle (ticket 005, V3.0 §2.3).
    """


class SyncConflict(Exception):
    """Levée quand `expected_latest_event_id` est fourni et ne correspond
    plus au dernier `TrustEvent` réel de la cible (Reserve si suivi, sinon
    WorkDeclaration/Evidence) — ticket 010 (CONTROL, passe 2) : la cible a
    été modifiée par ailleurs depuis la dernière synchronisation connue du
    client. La vérification et la création ont lieu dans la MÊME transaction
    (voir `_create_inspection_row`) : pas de fenêtre de course entre "je
    vérifie" et "je crée" — jamais un last-write-wins silencieux.

    Rien n'est écrit avant que cette exception ne soit levée : le `raise` se
    produit avant tout `Inspection.objects.create(...)`, donc la transaction
    englobante n'a besoin que d'un `raise`/retour, jamais d'un rollback
    explicite.
    """

    def __init__(self, current_event):
        self.current_event = current_event
        super().__init__(
            'La cible a été modifiée depuis la dernière synchronisation connue du client.',
        )


# Sentinelle distincte de `None` : `expected_latest_event_id=None` signifie
# explicitement "le client s'attend à ce qu'aucun événement n'existe encore
# pour cette cible" (vérifié), alors que ne pas fournir le paramètre du tout
# (valeur par défaut) signifie "aucune vérification de conflit" — comportement
# strictement inchangé pour tout appelant antérieur au ticket 010 (aucun ne
# passe ce paramètre).
_NOT_CHECKING_CONFLICT = object()


def create_inspection(
    *, inspector, inspector_organization, target_organization_id,
    work_declaration_id=None, evidence_id=None, outcome, note='', reserve_id=None,
    expected_latest_event_id=_NOT_CHECKING_CONFLICT, client_correlation_id=None,
):
    """Point d'entrée unique pour créer une `Inspection` — et donc la SEULE
    façon de faire progresser le cycle de vie d'une `Reserve`
    (`ReserveViewSet` est en lecture seule, voir apps/inspections/views.py).

    `target_organization_id` est fourni explicitement par l'appelant : sans
    mécanisme d'affectation/dispatch (hors scope, voir ticket 006 Task
    Inbox), l'inspecteur est la seule partie qui sait quelle organisation il
    inspecte. Le contexte RLS est explicitement basculé vers cette
    organisation le temps de l'opération, puis restauré — même schéma que
    le bootstrap de `RegisterSerializer.create` (ticket 001) : une
    exception étroite et documentée, jamais un contournement général de
    RLS. Limite connue : l'inspecteur ne peut pas relire ses inspections
    passées via l'API (elles vivent dans l'organisation cible, pas la
    sienne) — nécessiterait une requête cross-organisation dédiée, hors
    scope de ce ticket.
    """
    if str(target_organization_id) == str(inspector_organization.id):
        raise IndependenceRuleViolation(
            "L'inspecteur ne peut pas inspecter un lot de sa propre organisation "
            "(règle d'indépendance du contrôle).",
        )

    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            inspection = _create_inspection_row(
                inspector=inspector,
                target_organization_id=target_organization_id,
                work_declaration_id=work_declaration_id,
                evidence_id=evidence_id,
                outcome=outcome,
                note=note,
                reserve_id=reserve_id,
                expected_latest_event_id=expected_latest_event_id,
                client_correlation_id=client_correlation_id,
            )
        finally:
            # Toujours restaurer le contexte de l'inspecteur avant de rendre
            # la main — le reste de la requête ne doit jamais continuer avec
            # un contexte RLS élevé, succès ou échec.
            set_rls_context(organization_id=inspector_organization.id)

    return inspection


def _create_inspection_row(*, inspector, target_organization_id, work_declaration_id,
                            evidence_id, outcome, note, reserve_id,
                            expected_latest_event_id=_NOT_CHECKING_CONFLICT, client_correlation_id=None):
    target_organization = Organization.objects.filter(id=target_organization_id).first()
    if target_organization is None:
        raise ValidationError("organization cible introuvable.")

    work_declaration = None
    evidence = None
    if work_declaration_id:
        work_declaration = WorkDeclaration.objects.filter(
            id=work_declaration_id, organization=target_organization,
        ).first()
        if work_declaration is None:
            raise ValidationError("work_declaration introuvable dans l'organisation cible.")
        lot = work_declaration.milestone.lot
    else:
        evidence = Evidence.objects.filter(id=evidence_id, organization=target_organization).first()
        if evidence is None:
            raise ValidationError("evidence introuvable dans l'organisation cible.")
        lot = evidence.work_declaration.milestone.lot

    reserve = None
    if reserve_id:
        reserve = Reserve.objects.filter(id=reserve_id, organization=target_organization).first()
        if reserve is None:
            raise ValidationError("reserve introuvable dans l'organisation cible.")

    if expected_latest_event_id is not _NOT_CHECKING_CONFLICT:
        # Ticket 010 (CONTROL, passe 2) : la cible du conflit est la Reserve
        # pour une inspection de suivi (c'est elle que le client réexamine).
        # Sans réserve, ce n'est PAS le WorkDeclaration/Evidence lui-même :
        # son propre TrustEvent ("declare"/"evidence_upload") existe dès sa
        # création par le constructeur et n'a rien à voir avec une
        # inspection concurrente — le comparer aurait fait échouer TOUTE
        # première inspection en conflit. La cible est donc la DERNIÈRE
        # Inspection déjà enregistrée sur ce WorkDeclaration/Evidence (via
        # son propre événement `inspection_<outcome>`), `None` si aucune
        # n'existe encore. Comparaison faite ICI, dans la même transaction
        # que la création qui suit : aucune fenêtre de course possible.
        if reserve is not None:
            conflict_subject = reserve
        else:
            base_subject = work_declaration or evidence
            conflict_subject = base_subject.inspections.order_by('-created_at').first()
        current_event = trust_repository.get_current_status(conflict_subject) if conflict_subject else None
        current_event_id = str(current_event.id) if current_event else None
        if current_event_id != expected_latest_event_id:
            raise SyncConflict(current_event)

    inspection = Inspection.objects.create(
        organization=target_organization,
        lot=lot,
        inspector=inspector,
        work_declaration=work_declaration,
        evidence=evidence,
        outcome=outcome,
        reserve=reserve,
        note=note,
        client_correlation_id=client_correlation_id,
    )

    inspection_level = TrustLevel.VERIFIE if outcome == InspectionOutcome.CONFORME else TrustLevel.CONTROLE
    inspection_event = trust_repository.create(
        subject=inspection, organization=target_organization, level=inspection_level,
        actor=inspector, source=f'inspection_{outcome}',
    )

    if reserve is not None:
        # La cible d'un futur conflit sur CETTE réserve est la réserve
        # elle-même (voir la comparaison `expected_latest_event_id`
        # ci-dessus) — c'est donc SON dernier événement (`levee`/`rejetee`),
        # jamais celui de l'inspection de suivi, qu'il faut rendre au client.
        latest_event = _advance_existing_reserve(
            reserve=reserve, outcome=outcome, inspector=inspector, organization=target_organization,
        )
    else:
        if outcome == InspectionOutcome.AVEC_RESERVE:
            _open_new_reserve(inspection=inspection, inspector=inspector, organization=target_organization, lot=lot)
        # Sans réserve (ouverture ou simple « conforme »), la cible d'un
        # futur conflit reste le work_declaration/evidence lui-même — dérivé
        # comme « sa dernière Inspection », qui EST celle-ci (voir
        # `_NOT_CHECKING_CONFLICT` ci-dessus, même logique dupliquée ici
        # plutôt que requêtée à nouveau : l'événement vient d'être créé,
        # dans la même transaction).
        latest_event = inspection_event

    # Ticket 013 (bug 2 du rapport bout-en-bout) : sans cette valeur, un
    # client n'a AUCUN moyen légitime de resynchroniser cette même cible —
    # `knownLatestEventId` restait figé à sa valeur d'origine indéfiniment,
    # provoquant un conflit permanent dès la tentative suivante. Attribut
    # transitoire (jamais persisté, jamais un champ du modèle) : seul
    # `apps.control.services.sync_inspection` le lit ; tout appelant
    # préexistant de `create_inspection` (InspectionViewSet direct, fixtures
    # de test) continue de ne recevoir que `inspection`, comportement
    # inchangé.
    inspection.latest_event_id = latest_event.id

    return inspection


def _open_new_reserve(*, inspection, inspector, organization, lot):
    reserve = Reserve.objects.create(organization=organization, lot=lot, opened_by_inspection=inspection)
    trust_repository.create(
        subject=reserve, organization=organization, level=TrustLevel.CONTROLE,
        actor=inspector, source='ouverte',
    )

    # Ticket 006 : une réserve ouverte génère automatiquement une Task pour
    # le constructeur assigné au lot — via une vraie tâche Celery
    # asynchrone (.delay()), jamais un appel synchrone ici qui ne ferait que
    # ressembler à de l'asynchrone. Import différé : évite un cycle au
    # chargement (apps.tasks.tasks importe apps.inspections.models,
    # également en différé).
    from apps.tasks.tasks import process_reserve_opened

    process_reserve_opened.delay(
        reserve_id=str(reserve.id),
        organization_id=str(organization.id),
        actor_user_id=str(inspector.id),
    )

    return reserve


def _advance_existing_reserve(*, reserve, outcome, inspector, organization):
    """Retourne le DERNIER `TrustEvent` créé (`levee`/`rejetee`) — c'est lui
    qui devient le nouveau `expected_latest_event_id` de cette réserve pour
    tout appelant suivant, jamais l'intermédiaire `nouvelle_inspection`."""
    trust_repository.create(
        subject=reserve, organization=organization, level=TrustLevel.CONTROLE,
        actor=inspector, source='nouvelle_inspection',
    )
    if outcome == InspectionOutcome.CONFORME:
        return trust_repository.create(
            subject=reserve, organization=organization, level=TrustLevel.VALIDE,
            actor=inspector, source='levee',
        )
    return trust_repository.create(
        subject=reserve, organization=organization, level=TrustLevel.CONTROLE,
        actor=inspector, source='rejetee',
    )


def create_reserve_correction(*, organization, reserve, evidence, submitted_by):
    """Action permise au constructeur : documenter une correction. Ne
    change jamais directement le statut de la réserve — génère un nouvel
    événement (`correction_proposee`) qui fait progresser sa chaîne,
    exactement comme toute autre action métier de ce projet (voir
    apps/programs/services.py pour le même schéma : une action métier
    normale qui a un effet de bord TrustEvent, jamais un endpoint qui
    fixerait un statut directement).
    """
    correction = ReserveCorrection.objects.create(
        organization=organization, reserve=reserve, evidence=evidence, submitted_by=submitted_by,
    )
    trust_repository.create(
        subject=reserve, organization=organization, level=TrustLevel.DOCUMENTE,
        actor=submitted_by, source='correction_proposee',
    )
    return correction


def get_reserve_status(reserve):
    """Le statut courant d'une réserve n'est jamais stocké — il se dérive du
    dernier `TrustEvent` de ce sujet (doctrine Visible Trust, CLAUDE.md).
    Retourne `None` si la réserve n'a pas encore d'événement (ne devrait pas
    arriver : `_open_new_reserve` en crée toujours un dans la même
    transaction que la création de la réserve).
    """
    current_event = trust_repository.get_current_status(reserve)
    return current_event.source if current_event else None


# Un statut dérivé (voir get_reserve_status) parmi ces sources signifie que
# la réserve n'est pas encore résolue — `levee`/`rejetee` sont les deux
# seules sorties terminales (voir _advance_existing_reserve ci-dessus).
# Propriété du domaine Reserve lui-même : centralisé ici plutôt que dans
# apps.home ou apps.build pour que les deux (et tout futur consommateur)
# partagent exactement la même définition, jamais deux copies qui pourraient
# diverger. Déplacé depuis apps/home/services.py au ticket 009, quand un
# second consommateur (apps/build) en a eu besoin.
OPEN_RESERVE_STATUSES = {'ouverte', 'correction_proposee', 'nouvelle_inspection'}


def is_reserve_open(reserve):
    return get_reserve_status(reserve) in OPEN_RESERVE_STATUSES


class NotAnInspectorError(Exception):
    """L'utilisateur assigné ne détient le rôle `inspecteur` dans aucune de
    ses organisations — ticket 012, scope explicite : un `User` avec ce
    rôle suffit pour ce MVP, aucune matrice de compétences/certification.
    """


def _read_inspector_memberships(inspector, *, restore_user_id):
    """Lit TOUTES les `Membership` de `inspector`, quelle que soit
    l'organisation cible active — nécessaire pour la règle d'indépendance
    (savoir si `inspector` appartient à l'organisation cible) et le
    contrôle de rôle ci-dessous.

    `organizations_membership.membership_select` (ticket 001) n'autorise
    QUE la lecture de ses PROPRES lignes (`user_id = current_user`) —
    bascule donc temporairement `app.current_user_id` sur `inspector`, le
    temps de CETTE lecture seule, restaurée dans un `finally`. Même schéma,
    pour la même raison, que `apps.backoffice.services.get_user_memberships`
    (ticket 011) — dupliqué ici plutôt qu'importé : `apps.inspections` est
    un domaine fondateur, `apps.backoffice` en dépend, jamais l'inverse.
    """
    set_rls_context(user_id=inspector.id)
    try:
        return list(Membership.objects.filter(user=inspector).select_related('organization', 'role'))
    finally:
        set_rls_context(user_id=restore_user_id)


def create_mission(
    *, assigned_by, assigned_by_organization_id, target_organization_id,
    work_declaration_id, assigned_inspector,
):
    """Point d'entrée unique pour affecter une mission — ticket 012.
    L'appelant (`apps.backoffice.views.CreateMissionView`) a déjà vérifié
    que `assigned_by` détient le rôle `admin_keyimmo` (`IsAdminKeyimmo`,
    ticket 011) ; cette fonction ne revérifie pas ce rôle, mais revalide
    la règle d'indépendance du contrôle (V3.0 §2.3) **à l'affectation**,
    pas seulement à l'inspection elle-même (`create_inspection`) — sans
    cela, une affectation invalide pourrait exister en base, silencieusement
    inutilisable, jusqu'à l'échec tardif de la première tentative
    d'inspection.

    Même schéma de bascule RLS que `create_inspection` : contexte basculé
    vers l'organisation cible pour la durée de l'écriture, restauré dans un
    `finally` vers celle de l'appelant.
    """
    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            mission = _create_mission_row(
                assigned_by=assigned_by,
                target_organization_id=target_organization_id,
                work_declaration_id=work_declaration_id,
                assigned_inspector=assigned_inspector,
            )
        finally:
            set_rls_context(organization_id=assigned_by_organization_id)

    # Notification en effet de bord — exactement le même rôle que `Task`
    # pour `Reserve` (ticket 006) : `InspectionMission` reste l'objet
    # métier, `Task` n'est jamais sa source de vérité. Import différé :
    # même raison que `_open_new_reserve` (évite un cycle au chargement des
    # tasks Celery).
    from apps.tasks.tasks import process_mission_assigned

    process_mission_assigned.delay(
        mission_id=str(mission.id),
        organization_id=str(target_organization_id),
        actor_user_id=str(assigned_by.id),
    )

    return mission


def _create_mission_row(*, assigned_by, target_organization_id, work_declaration_id, assigned_inspector):
    target_organization = Organization.objects.filter(id=target_organization_id).first()
    if target_organization is None:
        raise ValidationError("organization cible introuvable.")

    work_declaration = WorkDeclaration.objects.filter(
        id=work_declaration_id, organization=target_organization,
    ).first()
    if work_declaration is None:
        raise ValidationError("work_declaration introuvable dans l'organisation cible.")

    inspector_memberships = _read_inspector_memberships(assigned_inspector, restore_user_id=assigned_by.id)

    if any(membership.organization_id == target_organization.id for membership in inspector_memberships):
        raise IndependenceRuleViolation(
            "L'inspecteur assigné ne peut pas appartenir à l'organisation cible "
            "(règle d'indépendance du contrôle).",
        )
    if not any(membership.role.code == INSPECTEUR_ROLE_CODE for membership in inspector_memberships):
        raise NotAnInspectorError(
            "L'utilisateur assigné ne détient le rôle inspecteur dans aucune organisation.",
        )

    return InspectionMission.objects.create(
        organization=target_organization,
        work_declaration=work_declaration,
        assigned_inspector=assigned_inspector,
        assigned_by=assigned_by,
    )


def _find_open_reserve_for_lot(lot):
    """La réserve actuellement ouverte de ce lot, `None` s'il n'y en a
    aucune — ticket 013. Plusieurs `Reserve` peuvent exister dans l'absolu
    pour un même lot (une par cycle ouverture/résolution) ; seule LA plus
    récente peut être encore ouverte à un instant donné dans ce MVP (une
    nouvelle mission de suivi n'est affectée qu'après ouverture, jamais en
    parallèle) — d'où le tri par date et le premier match, plutôt qu'une
    contrainte d'unicité en base qui sortirait du scope de ce ticket.
    """
    for candidate in Reserve.objects.filter(lot=lot).order_by('-created_at'):
        if is_reserve_open(candidate):
            return candidate
    return None


def list_missions_for_inspector(*, inspector, caller_organization_id):
    """Les missions affectées à `inspector`, avec un statut « faite / à
    faire » dérivé — jamais stocké (voir `InspectionMission`, doctrine
    Visible Trust). Une mission est faite si une `Inspection` existe déjà
    pour son `work_declaration`, créée par CET inspecteur précis.

    `Inspection` est scopée RLS par l'organisation CIBLE (pattern standard,
    ticket 005) — jamais lisible depuis l'organisation active de
    l'inspecteur. Bascule donc, PAR MISSION, vers l'organisation cible le
    temps de cette lecture, restaurée après chaque itération — même
    principe que `_read_inspector_memberships` ci-dessus, appliqué ici à
    `Inspection` plutôt qu'à `Membership`.

    Piège rencontré en écrivant le test bout-en-bout : la requête initiale
    ne doit PAS utiliser `select_related('work_declaration__...')`. Un
    `select_related` compile un INNER JOIN — `work_declaration`/`lot` sont
    eux-mêmes protégés par RLS avec la policy standard SEULE
    (`organization_id = current_org`, sans la branche `assigned_inspector`
    ajoutée à `InspectionMission`). Sous le contexte de l'inspecteur (son
    organisation active, jamais celle de la cible), ces tables jointes
    deviennent invisibles à RLS et le JOIN élimine la ligne entière —
    alors même que `InspectionMission` aurait été visible seule. D'où la
    traversée lot/bien/programme faite ICI, dans la boucle, sous le
    contexte de l'organisation CIBLE déjà basculé pour lire `Inspection` —
    jamais dans la requête initiale.
    """
    missions = list(
        InspectionMission.objects.filter(assigned_inspector=inspector).order_by('-created_at')
    )

    rows = []
    for mission in missions:
        set_rls_context(organization_id=mission.organization_id)
        try:
            completed = Inspection.objects.filter(
                work_declaration_id=mission.work_declaration_id, inspector=inspector,
            ).exists()
            lot = mission.work_declaration.milestone.lot
            open_reserve = _find_open_reserve_for_lot(lot)
            rows.append({
                'id': str(mission.id),
                'lot_name': lot.name,
                'asset_name': lot.asset.name,
                'program_name': lot.asset.program.name,
                'milestone_label': mission.work_declaration.milestone.label,
                'organization_id': str(mission.organization_id),
                'work_declaration_id': str(mission.work_declaration_id),
                'completed': completed,
                # Ticket 013 (bug 3 du rapport bout-en-bout) : sans ces deux
                # champs, une mission de suivi n'a AUCUN moyen légitime de
                # savoir quelle réserve elle concerne, ni quel
                # `known_latest_event_id` envoyer pour son tout premier essai
                # (voir `apps.control.sync.syncEngine.ts::syncDraft`, qui les
                # utilise respectivement pour `reserve` et pour amorcer
                # `InspectionDraft.knownLatestEventId` d'un brouillon neuf).
                'reserve_id': str(open_reserve.id) if open_reserve else None,
                'reserve_latest_event_id': (
                    str(trust_repository.get_current_status(open_reserve).id) if open_reserve else None
                ),
            })
        finally:
            set_rls_context(organization_id=caller_organization_id)
    return rows
