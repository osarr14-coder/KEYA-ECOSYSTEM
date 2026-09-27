from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.core.demo import demo_scope
from apps.core.rls import set_rls_context
from apps.evidence.models import Evidence, WorkDeclaration
from apps.organizations.models import Membership, Organization
from apps.programs.models import Program
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
    reserves=None, decisions=None, examined_evidence_ids=None,
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
                reserves=reserves,
                decisions=decisions,
                examined_evidence_ids=examined_evidence_ids,
            )
        finally:
            # Toujours restaurer le contexte de l'inspecteur avant de rendre
            # la main — le reste de la requête ne doit jamais continuer avec
            # un contexte RLS élevé, succès ou échec.
            set_rls_context(organization_id=inspector_organization.id)

    return inspection


def _create_inspection_row(*, inspector, target_organization_id, work_declaration_id,
                            evidence_id, outcome, note, reserve_id,
                            expected_latest_event_id=_NOT_CHECKING_CONFLICT, client_correlation_id=None,
                            reserves=None, decisions=None, examined_evidence_ids=None):
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

    declaration = work_declaration or evidence.work_declaration
    new_reserves, reserve_decisions, open_reserves = _validate_opinion(
        declaration=declaration, outcome=outcome, reserves=reserves, decisions=decisions,
    )
    examined = _examined_evidence_ids(declaration, examined_evidence_ids)

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
        examined_evidence_ids=examined,
        reserve_decisions=reserve_decisions,
    )

    inspection_level = TrustLevel.VERIFIE if outcome == InspectionOutcome.CONFORME else TrustLevel.CONTROLE
    inspection_event = trust_repository.create(
        subject=inspection, organization=target_organization, level=inspection_level,
        actor=inspector, source=f'inspection_{outcome}',
    )

    # Audit UI R1 (K03) : décision EXPLICITE sur chaque réserve ouverte —
    # jamais une levée implicite déduite de l'avis global.
    decision_events = {}
    for item in reserve_decisions:
        decided = open_reserves[item['reserve_id']]
        decision_events[item['reserve_id']] = _decide_reserve(
            reserve=decided, decision=item['decision'], inspector=inspector, organization=target_organization,
        )
    # Audit UI R1 (K02) : réserves structurées, plusieurs possibles. Leurs
    # identifiants sont gardés sur l'objet (attribut transitoire, comme
    # `latest_event_id`) : relues sous le contexte RLS du contrôleur, elles
    # seraient invisibles (elles vivent dans l'organisation du lot).
    inspection.created_reserves = [
        _open_new_reserve(
            inspection=inspection, inspector=inspector, organization=target_organization, lot=lot,
            motif=item['motif'], expected_action=item['expected_action'],
        )
        for item in new_reserves
    ]
    inspection.opened_reserve_ids = [str(reserve.id) for reserve in inspection.created_reserves]

    if reserve is not None and str(reserve.id) in decision_events:
        # La cible d'un futur conflit sur CETTE réserve est la réserve
        # elle-même (voir la comparaison `expected_latest_event_id`
        # ci-dessus) — c'est donc SON dernier événement (`levee`/`maintenue`),
        # jamais celui de l'inspection de suivi, qu'il faut rendre au client.
        latest_event = decision_events[str(reserve.id)]
    else:
        # Sans réserve suivie, la cible d'un futur conflit reste le
        # work_declaration/evidence lui-même — dérivé comme « sa dernière
        # Inspection », qui EST celle-ci (voir `_NOT_CHECKING_CONFLICT`).
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


def _open_reserves_of(declaration):
    """Réserves encore ouvertes, ouvertes par une inspection de cette
    déclaration (sur elle ou l'une de ses pièces), par id (str)."""
    reserves = Reserve.objects.filter(
        opened_by_inspection__in=_declaration_inspections(declaration),
    ).order_by('created_at')
    return {str(reserve.id): reserve for reserve in reserves if is_reserve_open(reserve)}


def _validate_opinion(*, declaration, outcome, reserves, decisions):
    """Audit UI R1 (K02/K03, CDC R1 §7.1) — règles d'un avis, appliquées par
    le serveur quelle que soit la voie d'entrée (API, CONTROL) :

    - chaque réserve ouverte de la déclaration reçoit une décision
      explicite, « levee » ou « maintenue », avec motif ;
    - un avis conforme lève toutes les réserves et n'en ouvre aucune ;
    - un avis non conforme ouvre au moins une réserve structurée (motif et
      action attendue) ou en maintient une.

    Retourne (nouvelles réserves, décisions normalisées, réserves ouvertes).
    """
    open_reserves = _open_reserves_of(declaration)
    normalized_decisions = []
    for item in decisions or []:
        reserve_id = str(item.get('reserve_id') or '')
        decision = item.get('decision')
        motif = (item.get('motif') or '').strip()
        if reserve_id not in open_reserves:
            raise ValidationError('Réserve inconnue ou déjà close pour cette déclaration.')
        if any(existing['reserve_id'] == reserve_id for existing in normalized_decisions):
            raise ValidationError('Une réserve ne peut recevoir qu’une seule décision par avis.')
        if decision not in RESERVE_DECISIONS:
            raise ValidationError('Décision de réserve invalide : « levee » ou « maintenue ».')
        if not motif:
            raise ValidationError('Le motif de chaque décision de réserve est obligatoire.')
        normalized_decisions.append({'reserve_id': reserve_id, 'decision': decision, 'motif': motif})
    undecided = [reserve for reserve_id, reserve in open_reserves.items()
                 if reserve_id not in {item['reserve_id'] for item in normalized_decisions}]
    if undecided:
        raise ValidationError(
            'Chaque réserve ouverte doit être levée ou maintenue explicitement, avec motif '
            f'({len(undecided)} réserve(s) sans décision).',
        )

    new_reserves = []
    for item in reserves or []:
        motif = (item.get('motif') or '').strip()
        expected_action = (item.get('expected_action') or '').strip()
        if not motif or not expected_action:
            raise ValidationError('Chaque réserve exige un motif et une action attendue du constructeur.')
        new_reserves.append({'motif': motif[:255], 'expected_action': expected_action})

    maintained = any(item['decision'] == RESERVE_MAINTAINED for item in normalized_decisions)
    if outcome == InspectionOutcome.CONFORME:
        if maintained:
            raise ValidationError('Un avis conforme exige la levée de chaque réserve ouverte.')
        if new_reserves:
            raise ValidationError('Un avis conforme n’ouvre aucune réserve.')
    elif not new_reserves and not maintained:
        raise ValidationError(
            'Un avis non conforme ouvre au moins une réserve (motif et action attendue) ou en maintient une.',
        )
    return new_reserves, normalized_decisions, open_reserves


def _examined_evidence_ids(declaration, examined_evidence_ids):
    """Audit UI R1 (K01) : versions examinées. Absent : toutes les pièces
    de la déclaration au moment de l'avis. Fourni : uniquement des pièces de
    cette déclaration."""
    current = [str(evidence_id) for evidence_id in Evidence.objects.filter(
        work_declaration=declaration,
    ).order_by('created_at').values_list('id', flat=True)]
    if examined_evidence_ids is None:
        return current
    examined = [str(evidence_id) for evidence_id in examined_evidence_ids]
    if any(evidence_id not in current for evidence_id in examined):
        raise ValidationError('Une pièce examinée n’appartient pas à cette déclaration.')
    return examined


def _open_new_reserve(*, inspection, inspector, organization, lot, motif='', expected_action=''):
    reserve = Reserve.objects.create(
        organization=organization, lot=lot, opened_by_inspection=inspection,
        motif=motif, expected_action=expected_action,
    )
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


RESERVE_LIFTED = 'levee'
RESERVE_MAINTAINED = 'maintenue'
RESERVE_DECISIONS = {RESERVE_LIFTED, RESERVE_MAINTAINED}


def _decide_reserve(*, reserve, decision, inspector, organization):
    """Audit UI R1 (K03) — décision explicite du contrôleur sur UNE réserve.
    Retourne le DERNIER `TrustEvent` créé (`levee`/`maintenue`) — c'est lui
    qui devient le nouveau `expected_latest_event_id` de cette réserve pour
    tout appelant suivant, jamais l'intermédiaire `nouvelle_inspection`.
    Une réserve maintenue reste OUVERTE (le constructeur peut proposer une
    nouvelle correction) ; auparavant, un recontrôle défavorable la fermait
    (`rejetee`, source conservée pour l'historique)."""
    trust_repository.create(
        subject=reserve, organization=organization, level=TrustLevel.CONTROLE,
        actor=inspector, source='nouvelle_inspection',
    )
    if decision == RESERVE_LIFTED:
        return trust_repository.create(
            subject=reserve, organization=organization, level=TrustLevel.VALIDE,
            actor=inspector, source='levee',
        )
    return trust_repository.create(
        subject=reserve, organization=organization, level=TrustLevel.CONTROLE,
        actor=inspector, source='maintenue',
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
OPEN_RESERVE_STATUSES = {'ouverte', 'correction_proposee', 'nouvelle_inspection', 'maintenue'}

# Audit UI R1 (K03) — libellés affichés au contrôleur et au constructeur.
RESERVE_STATUS_LABELS = {
    'ouverte': 'Ouverte',
    'correction_proposee': 'Correction proposée',
    'nouvelle_inspection': 'En recontrôle',
    'maintenue': 'Maintenue',
    'levee': 'Levée',
    'rejetee': 'Close sans levée (historique)',
}


def is_reserve_open(reserve):
    return get_reserve_status(reserve) in OPEN_RESERVE_STATUSES


def is_milestone_technically_accepted(milestone):
    """Ticket B-050 — « jalon techniquement accepté dans sa version
    courante » (CDC V3 §8.2), condition des appels de fonds par palier VEFA
    (B-050) et des décaissements (B-052). Vrai si et seulement si :

    1. la dernière inspection de la dernière déclaration du jalon (sur la
       déclaration elle-même ou l'une de ses pièces) est `conforme` — une
       réserve levée se termine précisément par une inspection conforme ;
    2. aucune réserve ouverte par une inspection de cette déclaration n'est
       encore ouverte ;
    3. aucune pièce n'a été ajoutée à la déclaration APRÈS cette inspection
       (CDC T07 : une pièce remplacée après acceptation la rend caduque,
       une nouvelle revue est nécessaire).

    Un jalon déclaré n'est pas un jalon accepté (CDC §1) ; une acceptation
    technique n'est ni une validation juridique ni une décision bancaire.
    Doit être appelé sous le contexte RLS de l'organisation du lot.
    """
    declaration = WorkDeclaration.objects.filter(milestone=milestone).order_by('-created_at').first()
    if declaration is None:
        return False
    inspections = Inspection.objects.filter(
        Q(work_declaration=declaration) | Q(evidence__work_declaration=declaration),
    )
    latest = inspections.order_by('-created_at').first()
    if latest is None or latest.outcome != InspectionOutcome.CONFORME:
        return False
    if any(is_reserve_open(reserve) for reserve in Reserve.objects.filter(opened_by_inspection__in=inspections)):
        return False
    return not Evidence.objects.filter(work_declaration=declaration, created_at__gt=latest.created_at).exists()


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

    **Ticket B-036** : `record_bc_charge_for_mission` est appelée ICI,
    DANS le `try:`, APRÈS la création de la mission mais AVANT le
    `finally` qui restaure le contexte RLS de l'appelant — la bascule vers
    l'organisation cible (celle du lot) doit encore être active, la charge
    BC étant une donnée financière de premier ordre, jamais un effet de
    bord asynchrone comme `process_mission_assigned` ci-dessous. Import
    différé pour la même raison (`apps.procurement` n'est jamais importé
    au niveau module par `apps.inspections`).
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

            from apps.procurement.services import record_bc_charge_for_mission

            record_bc_charge_for_mission(mission=mission, actor=assigned_by)
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

    # Audit UI R1 (D03) : jamais deux missions en attente sur la même
    # déclaration — une nouvelle mission (recontrôle) n'est possible qu'après
    # un avis rendu sur la précédente.
    pending = _pending_mission_for(work_declaration)
    if pending is not None:
        raise ValidationError(
            f"Une mission est déjà en attente pour cette déclaration (affectée à {pending.assigned_inspector.email}) : "
            "attendez l'avis du contrôleur avant d'en affecter une autre."
        )

    return InspectionMission.objects.create(
        organization=target_organization,
        work_declaration=work_declaration,
        assigned_inspector=assigned_inspector,
        assigned_by=assigned_by,
    )


def _pending_mission_for(work_declaration):
    """La mission encore sans avis de cette déclaration (aucune inspection
    postérieure à son affectation), `None` sinon. Sous contexte RLS de
    l'organisation cible."""
    latest = InspectionMission.objects.filter(work_declaration=work_declaration).select_related(
        'assigned_inspector',
    ).order_by('-created_at').first()
    if latest is None:
        return None
    answered = Inspection.objects.filter(
        work_declaration=work_declaration, created_at__gt=latest.created_at,
    ).exists()
    return None if answered else latest


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


def lot_has_open_reserve(lot):
    """Ticket B-052 — condition « aucune réserve ouverte » d'un décaissement
    (CDC V3 §8.2, T09). Sous contexte RLS de l'organisation du lot."""
    return _find_open_reserve_for_lot(lot) is not None


def mission_in_active_instance(mission):
    """Audit UI R1 (D01) — la mission relève-t-elle de l'instance de
    démonstration active ? À appeler sous le contexte RLS de l'organisation
    de la mission (lot, bien et programme y sont lisibles)."""
    return Program.objects.filter(
        demo_scope(), assets__lots__milestones__work_declarations__id=mission.work_declaration_id,
    ).exists()


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
            # Audit UI R1 (D01) : filtre d'instance appliqué APRÈS la bascule
            # vers l'organisation cible — une jointure vers le programme dans
            # la requête initiale serait éliminée par RLS (voir ci-dessus).
            if not mission_in_active_instance(mission):
                continue
            # Ticket 014 (friction du rapport bout-en-bout) : filtrer
            # seulement par work_declaration+inspecteur trouvait n'IMPORTE
            # QUELLE Inspection déjà soumise sur ce work_declaration — y
            # compris une, plus ANCIENNE, qui appartenait à une mission
            # PRÉCÉDENTE (ex. la première inspection, avant qu'une mission
            # de suivi ne soit affectée). Une mission de suivi fraîchement
            # créée s'affichait donc déjà « faite » avant même que
            # l'inspecteur n'y touche. `created_at__gt=mission.created_at`
            # borne la recherche aux Inspection VRAIMENT postérieures à
            # CETTE mission — la seule InspectionMission qui peut
            # légitimement l'avoir accomplie.
            completed = Inspection.objects.filter(
                work_declaration_id=mission.work_declaration_id, inspector=inspector,
                created_at__gt=mission.created_at,
            ).exists()
            # Ticket F-077 — recontrôle : une mission affectée APRÈS une
            # inspection antérieure du même jalon (quel qu'en soit
            # l'auteur). Reste vrai une fois la réserve levée, contrairement
            # à `reserve_id` : sans ce champ, CONTROL affichait un recontrôle
            # terminé comme une seconde « Première inspection », en double.
            follow_up = Inspection.objects.filter(
                work_declaration_id=mission.work_declaration_id,
                created_at__lte=mission.created_at,
            ).exists()
            lot = mission.work_declaration.milestone.lot
            open_reserve = _find_open_reserve_for_lot(lot)
            # Ticket 014 bis (friction 1 du 4e rapport bout-en-bout) :
            # `_find_open_reserve_for_lot` est scopé au LOT, pas à la
            # mission — une mission déjà `completed`, créée AVANT qu'une
            # réserve n'ouvre (par la faute d'une AUTRE mission, plus
            # récente, sur ce même lot), héritait à tort de cette réserve
            # simplement parce qu'elle vit sur le même lot. Une réserve
            # n'est légitimement « la sienne » que si elle existait DÉJÀ au
            # moment où CETTE mission a été affectée — sinon la mission ne
            # pouvait structurellement pas en avoir été la cause. Même
            # principe de bornage temporel que `completed` ci-dessus,
            # appliqué à `Reserve.created_at` plutôt qu'à `Inspection.
            # created_at`.
            mission_reserve = (
                open_reserve if open_reserve and open_reserve.created_at <= mission.created_at else None
            )
            # Audit UI R1 (K05, D03) : résultat de l'avis rendu pour CETTE
            # mission (la première inspection postérieure à son affectation)
            # et réserves ouvertes / levées ; date d'affectation pour
            # distinguer deux missions du même jalon.
            answer = Inspection.objects.filter(
                work_declaration_id=mission.work_declaration_id, inspector=inspector,
                created_at__gt=mission.created_at,
            ).order_by('created_at').first() if completed else None
            outcome = _mission_outcome(answer) if answer else None
            rows.append({
                'id': str(mission.id),
                'assigned_at': mission.created_at.isoformat(),
                'outcome': outcome,
                'lot_name': lot.name,
                'asset_name': lot.asset.name,
                'program_name': lot.asset.program.name,
                'milestone_label': mission.work_declaration.milestone.label,
                'organization_id': str(mission.organization_id),
                'work_declaration_id': str(mission.work_declaration_id),
                'completed': completed,
                'follow_up': follow_up,
                # Ticket 013 (bug 3 du rapport bout-en-bout) : sans ces deux
                # champs, une mission de suivi n'a AUCUN moyen légitime de
                # savoir quelle réserve elle concerne, ni quel
                # `known_latest_event_id` envoyer pour son tout premier essai
                # (voir `apps.control.sync.syncEngine.ts::syncDraft`, qui les
                # utilise respectivement pour `reserve` et pour amorcer
                # `InspectionDraft.knownLatestEventId` d'un brouillon neuf).
                'reserve_id': str(mission_reserve.id) if mission_reserve else None,
                'reserve_latest_event_id': (
                    str(trust_repository.get_current_status(mission_reserve).id) if mission_reserve else None
                ),
            })
        finally:
            set_rls_context(organization_id=caller_organization_id)
    return rows


def _mission_outcome(inspection):
    """Audit UI R1 (K05) — résultat d'un avis : conforme ou non, réserves
    ouvertes par cet avis, décisions de levée ou de maintien."""
    decisions = inspection.reserve_decisions or []
    return {
        'inspection_id': str(inspection.id),
        'outcome': inspection.outcome,
        'outcome_label': inspection.get_outcome_display(),
        'recorded_at': inspection.created_at.isoformat(),
        'reserves_opened': inspection.opened_reserves.count(),
        'reserves_lifted': sum(1 for decision in decisions if decision.get('decision') == 'levee'),
        'reserves_maintained': sum(1 for decision in decisions if decision.get('decision') == 'maintenue'),
    }


# ─── État de contrôle d'un jalon — ticket B-054 (CDC V3 §7.1) ───────────────

NOT_DECLARED = 'not_declared'
AWAITING_DOCUMENTS = 'awaiting_documents'
AWAITING_CONTROL = 'awaiting_control'
UNDER_RESERVE = 'under_reserve'
ACCEPTED = 'accepted'

CONTROL_STATUS_LABELS = {
    NOT_DECLARED: 'Non déclaré',
    AWAITING_DOCUMENTS: 'Déclaré — pièce à joindre',
    AWAITING_CONTROL: 'En attente de contrôle',
    UNDER_RESERVE: 'Sous réserve',
    ACCEPTED: 'Accepté techniquement',
}

# Audit UI R1, étape 3 (PO-2026-09-27-20, A-DS-4) — états d'affichage du
# CDC §7.1, DÉRIVÉS de l'état de contrôle ci-dessus sans changer le modèle :
#   aucune déclaration ou déclaration sans pièce → Brouillon
#   déclaration avec pièce, aucun contrôle programmé → Soumis
#   contrôle programmé (mission affectée, pas encore d'avis) → En examen
#   réserve ouverte sans correction déposée → Corrections demandées
#   réserve ouverte avec correction déposée → Resoumis
#   acceptation technique → Accepté techniquement
CDC_DRAFT = 'DRAFT'
CDC_SUBMITTED = 'SUBMITTED'
CDC_UNDER_REVIEW = 'UNDER_REVIEW'
CDC_CHANGES_REQUESTED = 'CHANGES_REQUESTED'
CDC_RESUBMITTED = 'RESUBMITTED'
CDC_TECHNICALLY_ACCEPTED = 'TECHNICALLY_ACCEPTED'

CDC_STATE_LABELS = {
    CDC_DRAFT: 'Brouillon',
    CDC_SUBMITTED: 'Soumis',
    CDC_UNDER_REVIEW: 'En examen',
    CDC_CHANGES_REQUESTED: 'Corrections demandées',
    CDC_RESUBMITTED: 'Resoumis',
    CDC_TECHNICALLY_ACCEPTED: 'Accepté techniquement',
}

# Précision affichée sous l'état quand le libellé du CDC seul ne dit pas ce
# qui est attendu.
CDC_STATE_HINTS = {
    NOT_DECLARED: 'Jalon pas encore déclaré',
    AWAITING_DOCUMENTS: 'Déclaré — pièce à joindre',
}


def milestone_cdc_state(state):
    """État CDC §7.1 `(code, libellé, précision)` d'un état de contrôle
    retourné par `milestone_control_state`."""
    status = state['status']
    if status in (NOT_DECLARED, AWAITING_DOCUMENTS):
        code = CDC_DRAFT
    elif status == ACCEPTED:
        code = CDC_TECHNICALLY_ACCEPTED
    elif status == UNDER_RESERVE:
        code = CDC_RESUBMITTED if state['correction_submitted'] else CDC_CHANGES_REQUESTED
    else:
        code = CDC_UNDER_REVIEW if state['pending_mission'] is not None else CDC_SUBMITTED
    return code, CDC_STATE_LABELS[code], CDC_STATE_HINTS.get(status, '')


def _declaration_inspections(declaration):
    return Inspection.objects.filter(Q(work_declaration=declaration) | Q(evidence__work_declaration=declaration))


def pending_mission_for(declaration):
    """La mission affectée sur cette déclaration et pas encore accomplie
    (aucune inspection de l'inspecteur assigné postérieure à l'affectation
    — même bornage que `list_missions_for_inspector`, ticket 014), `None`
    sinon."""
    inspections = _declaration_inspections(declaration)
    for mission in InspectionMission.objects.filter(work_declaration=declaration).select_related(
        'assigned_inspector',
    ).order_by('-created_at'):
        if not inspections.filter(inspector_id=mission.assigned_inspector_id, created_at__gt=mission.created_at).exists():
            return mission
    return None


def milestone_control_state(milestone):
    """État de contrôle du jalon, DÉRIVÉ de sa dernière déclaration (jamais
    stocké, doctrine Visible Trust). Sous contexte RLS de l'organisation du
    lot. Voir B-054 pour la table des états."""
    declaration = WorkDeclaration.objects.filter(milestone=milestone).order_by('-created_at').first()
    state = {
        'status': NOT_DECLARED, 'declaration': None, 'evidence_count': 0, 'latest_outcome': None,
        'reserve': None, 'correction_submitted': False, 'pending_mission': None,
    }
    if declaration is None:
        return state
    inspections = _declaration_inspections(declaration)
    latest = inspections.order_by('-created_at').first()
    open_reserve = _find_open_reserve_for_lot(milestone.lot)
    reserve = open_reserve if open_reserve and inspections.filter(id=open_reserve.opened_by_inspection_id).exists() else None
    evidence_count = Evidence.objects.filter(work_declaration=declaration).count()
    state.update({
        'declaration': declaration,
        'evidence_count': evidence_count,
        'latest_outcome': latest.outcome if latest else None,
        'reserve': reserve,
        'correction_submitted': bool(reserve and ReserveCorrection.objects.filter(reserve=reserve).exists()),
        'pending_mission': pending_mission_for(declaration),
    })
    if evidence_count == 0:
        state['status'] = AWAITING_DOCUMENTS
    elif is_milestone_technically_accepted(milestone):
        state['status'] = ACCEPTED
    elif reserve is not None:
        state['status'] = UNDER_RESERVE
    else:
        state['status'] = AWAITING_CONTROL
    return state


def list_controls_to_assign(*, caller_organization_id):
    """Déclarations à contrôler (`awaiting_control`, `under_reserve`), toutes
    organisations — admin KEYIMMO (ticket B-054). Même boucle de bascule RLS
    que les autres listes transverses ; tout est matérialisé en dicts sous
    le contexte de chaque organisation."""
    rows = []
    organization_ids = list(Organization.objects.values_list('id', flat=True))
    try:
        for organization_id in organization_ids:
            set_rls_context(organization_id=organization_id)
            milestone_ids = set(
                WorkDeclaration.objects.filter(organization_id=organization_id).values_list('milestone_id', flat=True),
            )
            from apps.programs.models import Milestone

            for milestone in Milestone.objects.filter(demo_scope('lot__asset__program__'), id__in=milestone_ids).select_related(
                'lot', 'lot__asset', 'lot__asset__program', 'lot__organization',
            ):
                state = milestone_control_state(milestone)
                if state['status'] not in (AWAITING_CONTROL, UNDER_RESERVE):
                    continue
                mission = state['pending_mission']
                rows.append({
                    'organization': {'id': str(organization_id), 'name': milestone.lot.organization.name},
                    'program': {'id': str(milestone.lot.asset.program_id), 'name': milestone.lot.asset.program.name},
                    'lot': {'id': str(milestone.lot_id), 'name': milestone.lot.name},
                    'milestone': {'id': str(milestone.id), 'code': milestone.code, 'label': milestone.label},
                    'work_declaration_id': str(state['declaration'].id),
                    'declared_at': state['declaration'].created_at,
                    'status': state['status'],
                    'status_label': milestone_cdc_state(state)[1],
                    'cdc_state': milestone_cdc_state(state)[0],
                    'evidence_count': state['evidence_count'],
                    'latest_outcome': state['latest_outcome'],
                    'correction_submitted': state['correction_submitted'],
                    'pending_mission': {
                        'id': str(mission.id), 'inspector_email': mission.assigned_inspector.email,
                        'assigned_at': mission.created_at,
                    } if mission else None,
                })
    finally:
        set_rls_context(organization_id=caller_organization_id)
    return sorted(rows, key=lambda row: row['declared_at'])
