from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.rls import set_rls_context
from apps.organizations.models import Organization
from apps.programs.models import Lot
from apps.trust import repository as trust_repository
from apps.trust.models import TrustLevel

from .models import Devis

# Source de TrustEvent qui marque LE devis retenu pour un lot — un devis
# sans TrustEvent de ce type est un simple candidat (voir get_devis_status).
DEVIS_LOCKED_SOURCE = 'devis_verrouille'

# Statut par défaut d'un devis sans TrustEvent — jamais stocké, voir
# get_devis_status. Distinct de DEVIS_LOCKED_SOURCE : les deux valeurs
# possibles du statut dérivé d'un Devis.
DEVIS_CANDIDATE_STATUS = 'candidat'


class LotAlreadyLockedError(Exception):
    """Un devis est déjà verrouillé pour ce lot — la mise en concurrence est
    close. Ni une nouvelle candidature (create_devis) ni un second
    verrouillage (lock_devis) ne sont acceptés une fois ce cas atteint.
    """


def _read_current_devis_event(devis):
    return trust_repository.get_current_status(devis)


def get_devis_status(devis, *, restore_organization_id):
    """Le statut d'un devis (`'candidat'` ou `DEVIS_LOCKED_SOURCE`) n'est
    jamais stocké — il se dérive du dernier `TrustEvent` de ce sujet
    (doctrine Visible Trust, CLAUDE.md), même schéma que
    `apps.inspections.services.get_reserve_status`.

    **Bascule RLS interne, systématique** : `TrustEvent.organization` vaut
    `devis.organization` (l'organisation du LOT), qui ne correspond NI à
    l'organisation active de l'admin après une écriture (`create_devis`/
    `lock_devis` restaurent déjà leur propre contexte AVANT que la vue ne
    sérialise la réponse), NI à celle d'un candidat qui lit sa propre
    candidature (`candidate_organization`, jamais `organization`). Bug réel
    trouvé en écrivant les tests de ce module : sans cette bascule, un
    devis fraîchement verrouillé revenait `'candidat'` dans la réponse de
    verrouillage elle-même (RLS bloquait silencieusement la lecture du
    `TrustEvent` qui venait pourtant d'être créé, dans la MÊME requête).
    Même schéma que `apps.backoffice.services.get_user_memberships`
    (ticket 011) : une bascule étroite et documentée, jamais un
    élargissement de policy — `restore_organization_id` est TOUJOURS fourni
    explicitement par l'appelant (l'organisation active RÉELLE de qui lit),
    jamais deviné.
    """
    set_rls_context(organization_id=devis.organization_id)
    try:
        current_event = _read_current_devis_event(devis)
    finally:
        set_rls_context(organization_id=restore_organization_id)
    return current_event.source if current_event else DEVIS_CANDIDATE_STATUS


def is_lot_locked(lot_id):
    """Vrai si un devis de ce lot est déjà verrouillé — la mise en
    concurrence est close. Itère les devis du lot (quelques candidats par
    lot au plus, pas des centaines de lots comme le ticket 009) : pas de
    requête agrégée nécessaire ici, voir le ticket, section « hors scope ».

    Appelée UNIQUEMENT depuis `create_devis`/`lock_devis`, déjà basculés
    sur l'organisation du lot au moment de l'appel — lecture DIRECTE
    (`_read_current_devis_event`), sans bascule supplémentaire : passer par
    `get_devis_status` ici ferait une bascule vers la même organisation que
    celle déjà active (no-op) mais complexifierait cet appel sans raison,
    voir `get_devis_status` pour la version sûre utilisée par les
    lectures « froides » (vues, candidats).
    """
    for devis in Devis.objects.filter(lot_id=lot_id):
        event = _read_current_devis_event(devis)
        if event is not None and event.source == DEVIS_LOCKED_SOURCE:
            return True
    return False


def create_devis(
    *, logged_by, logged_by_organization_id, target_organization_id,
    lot_id, candidate_organization_id, amount,
):
    """Point d'entrée unique pour enregistrer un devis reçu — ticket 022.
    L'appelant (`apps.procurement.views.DevisCreateView`) a déjà vérifié
    que `logged_by` détient le rôle `admin_keyimmo` (`IsAdminKeyimmo`,
    ticket 011) ; cette fonction ne revérifie pas ce rôle.

    Même schéma de bascule RLS que `create_inspection`/`create_mission`
    (tickets 005/012) : `target_organization_id` (l'organisation du LOT,
    pas celle du candidat) est fourni explicitement par l'appelant — même
    conséquence assumée que `create_inspection` (ticket 005) : lire `Lot`
    sous le contexte RLS de l'ADMIN échouerait silencieusement si l'admin
    n'est pas membre de cette organisation, donc `target_organization_id`
    ne peut pas être dérivé APRÈS coup depuis `lot_id` seul.
    """
    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            devis = _create_devis_row(
                logged_by=logged_by,
                target_organization_id=target_organization_id,
                lot_id=lot_id,
                candidate_organization_id=candidate_organization_id,
                amount=amount,
            )
        finally:
            set_rls_context(organization_id=logged_by_organization_id)
    return devis


def _create_devis_row(*, logged_by, target_organization_id, lot_id, candidate_organization_id, amount):
    target_organization = Organization.objects.filter(id=target_organization_id).first()
    if target_organization is None:
        raise ValidationError("organization cible introuvable.")

    lot = Lot.objects.filter(id=lot_id, organization=target_organization).first()
    if lot is None:
        raise ValidationError("lot introuvable dans l'organisation cible.")

    candidate_organization = Organization.objects.filter(id=candidate_organization_id).first()
    if candidate_organization is None:
        raise ValidationError({'candidate_organization': 'Organisation candidate introuvable.'})

    if is_lot_locked(lot.id):
        raise LotAlreadyLockedError(
            'La mise en concurrence de ce lot est déjà verrouillée — aucun nouveau devis accepté.',
        )

    return Devis.objects.create(
        organization=target_organization,
        candidate_organization=candidate_organization,
        lot=lot,
        amount=amount,
        logged_by=logged_by,
    )


def list_devis_for_lot_as_admin(*, admin, admin_organization_id, target_organization_id, lot_id):
    """Tous les devis d'un lot, montants inclus — SEUL point d'entrée de ce
    module qui retourne des montants (voir `DevisAdminSerializer`, seul
    serializer à exposer `amount`). Bascule RLS en lecture seule vers
    l'organisation du lot, PAS de `transaction.atomic()` explicite ici :
    `apps.core.middleware.OrganizationScopeMiddleware` ouvre déjà une
    transaction englobant toute la requête — même schéma que
    `apps.backoffice.services.get_user_memberships` (ticket 011), qui ne
    s'entoure pas non plus de son propre bloc pour la même raison. Tous les
    devis d'un même lot partagent le même `organization_id` (celui du lot),
    quel que soit leur `candidate_organization` — une seule bascule suffit
    pour les voir TOUS en une seule requête, contrairement à une lecture
    scopée par candidat qui nécessiterait une bascule par candidat.
    """
    set_rls_context(organization_id=target_organization_id)
    try:
        return list(Devis.objects.filter(lot_id=lot_id).order_by('created_at'))
    finally:
        set_rls_context(organization_id=admin_organization_id)


def lock_devis(*, admin, admin_organization_id, target_organization_id, devis_id):
    """Verrouille un devis — LE geste qui sélectionne le devis retenu pour
    ce lot, seul `admin_keyimmo` peut l'exécuter (vérifié par l'appelant,
    voir `create_devis` ci-dessus pour le même raisonnement). Crée un
    `TrustEvent` (`DEVIS_LOCKED_SOURCE`) via `apps.trust.repository` — seul
    point d'entrée pour créer un `TrustEvent` (ticket 003), jamais un champ
    modifié sur `Devis` lui-même.

    Même bascule RLS explicite que `create_devis` : `target_organization_id`
    fourni par l'appelant, restauré dans un `finally`.
    """
    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            devis = Devis.objects.filter(id=devis_id, organization_id=target_organization_id).first()
            if devis is None:
                raise ValidationError("devis introuvable dans l'organisation cible.")

            if is_lot_locked(devis.lot_id):
                raise LotAlreadyLockedError(
                    'Un devis est déjà verrouillé pour ce lot — un seul devis verrouillé par lot.',
                )

            trust_repository.create(
                subject=devis,
                organization=devis.organization,
                level=TrustLevel.VALIDE,
                actor=admin,
                source=DEVIS_LOCKED_SOURCE,
            )
        finally:
            set_rls_context(organization_id=admin_organization_id)
    return devis
