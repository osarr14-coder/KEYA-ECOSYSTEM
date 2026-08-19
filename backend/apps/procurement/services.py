from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum

from apps.core.rls import set_rls_context
from apps.organizations.models import Organization
from apps.pricing.models import PricingCanal
from apps.pricing.services import get_active_rate
from apps.programs.models import Lot
from apps.trust import repository as trust_repository
from apps.trust.models import TrustLevel

from .models import Devis, DevisAjustement

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


class DevisNotLockedError(Exception):
    """Ticket 023 : un ajustement ne peut porter que sur le devis
    VERROUILLÉ d'un lot (l'offre gagnante) — jamais un simple candidat.
    """


class MarginExceededError(Exception):
    """Ticket 023 : l'écart proposé dépasse la marge disponible COURANTE du
    devis (marge_estimee moins la somme signée des ajustements déjà
    acceptés) — aucun `DevisAjustement` n'est créé quand cette exception
    est levée, même discipline que `LotAlreadyLockedError`.
    """


class NoPricingConfigError(Exception):
    """Ticket 026 : aucun `PricingConfig` `canal_1_marge` actif n'existe
    pour le `country_pack` du lot — `marge_estimee` ne peut être dérivé,
    la création du devis est bloquée AVANT toute écriture (aucune ligne
    créée), jamais un champ vide ni une valeur par défaut silencieuse.
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


def get_candidate_visible_devis_status(devis, *, restore_organization_id):
    """Ticket 023 — statut EXPOSÉ AU CANDIDAT, distinct de `get_devis_status`
    (qui reste inchangée, utilisée par le serializer admin et par la
    logique interne `create_devis`/`lock_devis`/`is_lot_locked`, qui ont
    besoin du statut RÉEL immédiatement, y compris pour empêcher un second
    verrouillage sur le même lot avant toute réconciliation).

    **Bug réel trouvé au ticket 022, corrigé ici** : sans cette fonction, un
    candidat voyait `status: "devis_verrouille"` dès l'INSTANT où
    `admin_keyimmo` verrouillait son devis (`lock_devis`) — avant même
    qu'une seule réconciliation n'ait eu lieu. Un devis verrouillé mais
    jamais réconcilié pouvait donc afficher « gagnant » à tort au candidat,
    alors que rien ne garantissait encore que l'écart tiendrait dans la
    marge disponible.

    Retourne le statut RÉEL, SAUF s'il vaut `DEVIS_LOCKED_SOURCE` et
    qu'aucun `DevisAjustement` n'existe encore pour ce devis — dans ce cas,
    retourne `DEVIS_CANDIDATE_STATUS` : le candidat ne voit « gagnant »
    qu'une fois AU MOINS une réconciliation réussie enregistrée (un
    ajustement refusé ne crée jamais de ligne, donc ne peut jamais, à tort,
    faire apparaître ce statut plus tôt).
    """
    raw_status = get_devis_status(devis, restore_organization_id=restore_organization_id)
    if raw_status != DEVIS_LOCKED_SOURCE:
        return raw_status

    set_rls_context(organization_id=devis.organization_id)
    try:
        has_successful_reconciliation = DevisAjustement.objects.filter(devis=devis).exists()
    finally:
        set_rls_context(organization_id=restore_organization_id)

    return DEVIS_LOCKED_SOURCE if has_successful_reconciliation else DEVIS_CANDIDATE_STATUS


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

    **`marge_estimee` n'est PLUS un paramètre depuis le ticket 026** —
    dérivé exclusivement du dernier `PricingConfig` `canal_1_marge` actif
    pour le `country_pack` du LOT (`target_organization.country_pack`,
    décision de conception A du ticket 026 — jamais celui du candidat).
    Invariant 25.10/25.15 (CLAUDE.md, section « Invariants du modèle
    économique ») : aucun calcul métier dérivé n'est injectable depuis
    l'extérieur, `admin_keyimmo` inclus — aucune échappatoire manuelle.

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


def _create_devis_row(
    *, logged_by, target_organization_id, lot_id, candidate_organization_id, amount,
):
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

    # Ticket 026 — décision A : le country_pack déterminant est celui du
    # LOT (target_organization), JAMAIS celui du candidat, qui peut en
    # théorie différer sans que ça change le pays d'application du barème
    # de CETTE affaire.
    active_rate = get_active_rate(
        country_pack_id=target_organization.country_pack_id, canal=PricingCanal.CANAL_1_MARGE,
    )
    if active_rate is None:
        raise NoPricingConfigError(
            f"Aucun taux de marge (canal 1) configuré pour le pays "
            f"« {target_organization.country_pack.label} » — impossible de créer un devis.",
        )

    return Devis.objects.create(
        organization=target_organization,
        candidate_organization=candidate_organization,
        lot=lot,
        amount=amount,
        marge_estimee=_derive_marge_estimee(amount=amount, rate_percent=active_rate.rate),
        logged_by=logged_by,
    )


def _derive_marge_estimee(*, amount, rate_percent):
    """`marge_estimee = amount × (rate_percent / 100)` — `PricingConfig.rate`
    est un POURCENTAGE (ticket 025, ex. `12.50` pour 12,50 %), `amount` un
    montant absolu ; une simple affectation directe du taux au champ
    montant serait dimensionnellement fausse (et débordait littéralement
    `PricingConfig.rate`, dimensionné `max_digits=5` pour un pourcentage,
    quand testé avec un montant à 5 chiffres — bug réel trouvé au premier
    lancement des tests de ce ticket).

    **Limite assumée, documentée explicitement (ticket 026, section «
    Limite assumée »)** : approxime la marge sur le seul poste
    `amount` (l'offre de construction du candidat), pas sur un coût de
    revient total agrégé (foncier + construction + bureau d'études +
    bureau de contrôle) tel que décrit dans le modèle économique de
    référence pour le canal 1 — cette agrégation n'existe pas encore dans
    ce projet. Approximation jugée suffisante pour le canal 2, hors scope
    de ce ticket (aucun mécanisme ne l'utilise).

    Arrondi à 2 décimales, `ROUND_HALF_UP` (arrondi commercial standard —
    explicite plutôt que le `ROUND_HALF_EVEN` implicite de `Decimal` par
    défaut, pour un résultat prévisible et vérifiable dans les tests).
    """
    return (amount * rate_percent / Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


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


def available_margin(devis):
    """Marge disponible COURANTE pour un nouvel ajustement sur ce devis —
    `marge_estimee` moins la somme SIGNÉE de tous les `DevisAjustement`
    déjà acceptés (ticket 023, point A) : un écart favorable (négatif)
    AUGMENTE cette marge pour l'ajustement suivant, un écart défavorable
    (positif) la RÉDUIT — jamais une somme de valeurs absolues, qui
    traiterait les deux sens de la même façon à tort.

    Lecture DIRECTE, sans bascule : appelée uniquement depuis
    `create_ajustement`, déjà basculé sur l'organisation du devis au moment
    de l'appel — même discipline que `is_lot_locked`.
    """
    total_ecarts = devis.ajustements.aggregate(total=Sum('ecart'))['total'] or Decimal('0')
    return devis.marge_estimee - total_ecarts


def create_ajustement(*, admin, admin_organization_id, target_organization_id, devis_id, ecart):
    """Point d'entrée unique pour enregistrer un ajustement de coût sur le
    devis VERROUILLÉ d'un lot — ticket 023. L'appelant
    (`apps.procurement.views.DevisAjustementCreateView`) a déjà vérifié que
    `admin` détient `admin_keyimmo` ; cette fonction ne revérifie pas ce
    rôle. Même schéma de bascule RLS explicite que `create_devis`/
    `lock_devis` : `target_organization_id` fourni par l'appelant.

    **Refusé (`MarginExceededError`) si `ecart` dépasse la marge disponible
    COURANTE — AUCUNE ligne `DevisAjustement` créée** (même discipline que
    `LotAlreadyLockedError`).

    **Piège de transaction évité, pas seulement documenté** : la Task
    `ALERT` créée sur refus (`apps.tasks.services.
    create_task_for_devis_ajustement_refuse`) ne doit JAMAIS être écrite à
    l'intérieur du même bloc `transaction.atomic()` que celui qui lève
    ensuite `MarginExceededError` — une exception qui se propage hors d'un
    `with transaction.atomic():` fait ROLLBACK de TOUT ce qui a été écrit
    DANS ce bloc, Task incluse, la faisant disparaître silencieusement
    malgré un 409 renvoyé au client. Corrigé en structurant la fonction en
    étapes séquentielles DISTINCTES : (1) lecture seule (devis, statut,
    marge disponible), sans `atomic()` propre — même discipline que
    `list_devis_for_lot_as_admin` (ticket 022), qui s'appuie déjà sur la
    transaction ouverte par le middleware RLS ; (2) SI refusé, écriture de
    la Task dans sa PROPRE portée, PUIS le `raise` — hors de toute portée
    encore capable de l'annuler ; (3) SI accepté, écriture du
    `DevisAjustement` dans son propre `with transaction.atomic():`, comme
    `create_devis`/`lock_devis`.
    """
    set_rls_context(organization_id=target_organization_id)
    try:
        devis = Devis.objects.filter(id=devis_id, organization_id=target_organization_id).first()
        if devis is None:
            raise ValidationError("devis introuvable dans l'organisation cible.")

        current_event = _read_current_devis_event(devis)
        if current_event is None or current_event.source != DEVIS_LOCKED_SOURCE:
            raise DevisNotLockedError(
                "Seul le devis verrouillé (l'offre gagnante) peut recevoir un ajustement.",
            )

        disponible = available_margin(devis)
        margin_exceeded = ecart > disponible
    finally:
        set_rls_context(organization_id=admin_organization_id)

    if margin_exceeded:
        # Import différé : même raison que `create_mission`/
        # `_open_new_reserve` (évite un cycle au chargement des tasks
        # Celery) — même si CET appel-ci est synchrone (voir docstring de
        # `create_task_for_devis_ajustement_refuse`), le module
        # `apps.tasks.services` importe des éléments liés à Celery en
        # cascade.
        from apps.tasks.services import create_task_for_devis_ajustement_refuse

        set_rls_context(organization_id=target_organization_id)
        try:
            create_task_for_devis_ajustement_refuse(devis, admin)
        finally:
            set_rls_context(organization_id=admin_organization_id)
        raise MarginExceededError(
            f"Écart ({ecart}) au-delà de la marge disponible ({disponible}).",
        )

    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            ajustement = DevisAjustement.objects.create(
                organization=devis.organization,
                devis=devis,
                ecart=ecart,
                created_by=admin,
            )
            # Recalculée APRÈS création (pas `disponible - ecart`, pour ne
            # dépendre d'aucune hypothèse d'arithmétique dupliquée) — encore
            # sous la bascule correcte, contrairement à un calcul fait plus
            # tard côté vue (voir le piège RLS déjà rencontré et corrigé au
            # ticket 022 pour `get_devis_status`).
            marge_resultante = available_margin(devis)
        finally:
            set_rls_context(organization_id=admin_organization_id)
    return ajustement, marge_resultante


def list_ajustements_for_devis_as_admin(*, admin, admin_organization_id, target_organization_id, devis_id):
    """Tous les ajustements d'un devis, montants inclus — même bascule que
    `list_devis_for_lot_as_admin` (ticket 022), pas de
    `transaction.atomic()` explicite pour la même raison (middleware RLS
    ouvre déjà une transaction englobant toute la requête).
    """
    set_rls_context(organization_id=target_organization_id)
    try:
        return list(DevisAjustement.objects.filter(devis_id=devis_id).order_by('created_at'))
    finally:
        set_rls_context(organization_id=admin_organization_id)
