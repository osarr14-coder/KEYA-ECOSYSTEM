from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Sum

from apps.core.rls import set_rls_context
from apps.organizations.models import Organization
from apps.pricing.models import ControlOfficeCalculationMode, PricingCanal
from apps.pricing.services import GLOBAL_CONTROL_OFFICE_JALON_TYPE, get_active_control_office_rate, get_active_rate
from apps.programs import services as programs_services
from apps.programs.models import Lot
from apps.trust import repository as trust_repository
from apps.trust.models import TrustLevel

from .models import Devis, DevisAjustement, LotBcCharge, LotLedger

# Source de TrustEvent qui marque LE devis retenu pour un lot — un devis
# sans TrustEvent de ce type est un simple candidat (voir get_devis_status).
DEVIS_LOCKED_SOURCE = 'devis_verrouille'

# Statut par défaut d'un devis sans TrustEvent — jamais stocké, voir
# get_devis_status. Distinct de DEVIS_LOCKED_SOURCE : les deux valeurs
# possibles du statut dérivé d'un Devis.
DEVIS_CANDIDATE_STATUS = 'candidat'

# Ticket B-028 — même valeur que apps.backoffice.services.MAX_SEARCH_RESULTS
# (ticket 011), redéfinie ici plutôt qu'importée : chaque app possède sa
# propre constante de recherche, pas de couplage inter-app pour une valeur
# qui pourrait diverger légitimement (même choix déjà fait pour
# LATEST_FIRST_ORDERING, redéfini par app plutôt que partagé).
MAX_SEARCH_RESULTS = 50


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


class LotDevisNotLockedError(Exception):
    """Ticket B-035, décision D : un grand-livre (`LotLedger`) ne peut être
    créé que pour un lot dont le `Devis` est déjà VERROUILLÉ — cohérent
    avec la logique VEFA (tout se construit sur des devis/contrats
    estimés) : créer un grand-livre avant la sélection du constructeur
    n'aurait aucun sens (`construction_courante` serait indéfinie).
    Aucune ligne `LotLedger` créée quand cette exception est levée.
    """


class LotLedgerAlreadyExistsError(Exception):
    """Ticket B-035, décision B : au plus UN grand-livre par lot, garanti
    par la contrainte `UNIQUE` réelle du `OneToOneField` `LotLedger.lot`
    (pas seulement une vérification applicative). Levée à la fois par une
    vérification explicite préalable ET par le rattrapage d'`IntegrityError`
    d'une création concurrente (voir `create_lot_ledger`) — DIFFÉRENCE avec
    `_upsert_active_pointer` (ticket B-027) : ici, une course détectée ne
    bascule JAMAIS vers une mise à jour de la ligne existante, `LotLedger`
    est immuable.
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


def get_devis_lot_detail(devis, *, restore_organization_id):
    """Ticket B-029 — `lot_detail` de `DevisAdminSerializer`, sous la
    bascule RLS correcte. **Même piège déjà documenté pour
    `get_devis_status`** : après `create_devis`/`lock_devis`, le contexte
    RLS de la connexion est déjà celui de l'admin (restauré AVANT que la
    vue ne sérialise la réponse), pas celui du lot. `Lot`/`Asset`/`Program`
    sont sous RLS (migration `apps/programs/migrations/0002_programs_rls.py`)
    — accéder à `devis.lot.asset`/`.asset.program` sans bascule échoue en
    `Asset.DoesNotExist` (bug réel trouvé au premier lancement des tests
    de ce ticket, `TestDevisCreation::test_admin_keyimmo_can_create_a_devis`) :
    `devis.lot` lui-même reste accessible (déjà mis en cache par `create_
    devis`/`lock_devis`), mais `lot.asset`/`lot.asset.program`, jamais
    chargés jusque-là, déclenchent une requête FRAÎCHE sous le MAUVAIS
    contexte RLS.

    Import différé de `.serializers` (niveau fonction, pas module) : évite
    l'import circulaire, `serializers.py` importe déjà `from . import
    services` au niveau module.

    Sans effet mesurable pour `DevisAdminListView` (`list_devis_for_lot_
    as_admin`, qui charge déjà `lot__organization`/`lot__asset__program`
    via `select_related` PENDANT sa propre bascule) : la bascule ici ne
    fait alors que deux appels `set_config` inoffensifs, `LotSearchResult
    Serializer` lit des attributs DÉJÀ en cache, aucune requête SQL
    supplémentaire.
    """
    from .serializers import LotSearchResultSerializer

    set_rls_context(organization_id=devis.organization_id)
    try:
        return LotSearchResultSerializer(devis.lot).data
    finally:
        set_rls_context(organization_id=restore_organization_id)


def get_devis_candidate_organization_detail(devis, *, restore_organization_id):
    """Ticket B-029 — `candidate_organization_detail` de
    `DevisAdminSerializer`. `organizations_organization` n'a AUCUNE RLS
    (vérifié au ticket B-028) : cette bascule n'est pas STRICTEMENT
    nécessaire pour cette lecture précise, mais la poser quand même
    documente explicitement que ce n'est délibérément pas un oubli, et
    évite qu'un futur ajout de RLS sur `Organization` ne réintroduise
    silencieusement le même piège que `get_devis_lot_detail` ci-dessus
    sans que personne n'y pense.
    """
    from .serializers import OrganizationSearchResultSerializer

    set_rls_context(organization_id=devis.organization_id)
    try:
        return OrganizationSearchResultSerializer(devis.candidate_organization).data
    finally:
        set_rls_context(organization_id=restore_organization_id)


def is_lot_locked(lot_id):
    """Vrai si un devis de ce lot est déjà verrouillé — la mise en
    concurrence est close. Itère les devis du lot (quelques candidats par
    lot au plus, pas des centaines de lots comme le ticket 009) : pas de
    requête agrégée nécessaire ici, voir le ticket, section « hors scope ».

    Appelée UNIQUEMENT depuis `create_devis`/`lock_devis`/
    `search_lots_as_admin` (ticket B-028), déjà basculés sur l'organisation
    du lot au moment de l'appel — lecture DIRECTE (`_read_current_devis_
    event`), sans bascule supplémentaire : passer par `get_devis_status`
    ici ferait une bascule vers la même organisation que celle déjà
    active (no-op) mais complexifierait cet appel sans raison, voir
    `get_devis_status` pour la version sûre utilisée par les lectures
    « froides » (vues, candidats).
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

    `select_related` (ticket B-029) : `DevisAdminSerializer.lot_detail`/
    `candidate_organization_detail` accèdent à `lot__organization`,
    `lot__asset__program` et `candidate_organization` pour CHAQUE devis de
    la liste — sans ce `select_related`, N devis d'un même lot
    redéclencheraient chacun leurs propres requêtes vers le MÊME lot/la
    même organisation (Django ne déduplique jamais entre instances
    distinctes), un N+1 évitable puisque connu à l'avance ici.
    """
    set_rls_context(organization_id=target_organization_id)
    try:
        return list(
            Devis.objects.filter(lot_id=lot_id)
            .select_related('lot__organization', 'lot__asset__program', 'candidate_organization')
            .order_by('created_at'),
        )
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


def get_locked_devis_for_lot(lot_id):
    """Le `Devis` VERROUILLÉ de ce lot — `None` si aucun. Ticket B-035 :
    même itération que `is_lot_locked` (ticket 022), retourne l'OBJET
    plutôt qu'un booléen — nécessaire pour dériver `construction_courante`
    d'un grand-livre (voir `get_construction_amount`/`get_lot_ledger_margin`).

    Même précondition d'appel que `is_lot_locked` : appelée sous la
    bascule RLS déjà positionnée sur l'organisation du lot, sans bascule
    supplémentaire ici.
    """
    for devis in Devis.objects.filter(lot_id=lot_id):
        event = _read_current_devis_event(devis)
        if event is not None and event.source == DEVIS_LOCKED_SOURCE:
            return devis
    return None


def get_construction_amount(devis):
    """Montant construction COURANT d'un devis verrouillé — ticket B-035 :
    `devis.amount` plus la somme SIGNÉE de tous ses `DevisAjustement`
    (positif = surcoût, l'augmente ; négatif = économie, le réduit — même
    convention de signe que `available_margin`, ticket 023).

    **Grandeur DIFFÉRENTE de `available_margin(devis)`** : celle-ci calcule
    la marge KEYIMMO sur ce devis (`marge_estimee - Σécarts`), pas un
    montant de construction — les deux fonctions partagent la même somme
    d'écarts mais l'appliquent à des bases différentes, jamais
    interchangeables.

    Lecture DIRECTE, sans bascule — même discipline que `available_margin`
    (appelée sous une bascule déjà positionnée par l'appelant).
    """
    total_ecarts = devis.ajustements.aggregate(total=Sum('ecart'))['total'] or Decimal('0')
    return devis.amount + total_ecarts


def get_lot_ledger_margin(ledger):
    """Marge disponible COURANTE d'un grand-livre — ticket B-035, formule
    COMPLÉTÉE par le ticket B-036 (fermeture du TODO laissé par B-035).
    Calculée À LA VOLÉE, JAMAIS stockée (doctrine Visible Trust) :
    `prix_client - foncier_alloue - be_alloue - construction_courante -
    Σ LotBcCharge.montant` (toutes les charges bureau de contrôle du lot,
    fixes et globale confondues — voir `record_bc_charge_for_mission`).
    Ne jamais dupliquer cette formule ailleurs, toujours passer par cette
    fonction (même discipline que `apps.pricing.services.
    get_active_control_office_rate`, seule source de vérité).

    Lecture DIRECTE, sans bascule : appelée uniquement depuis un appelant
    déjà basculé sur l'organisation du lot (la même que `ledger.
    organization`, le devis verrouillé de ce lot, et ses `LotBcCharge`) —
    même discipline que `available_margin`.
    """
    devis = get_locked_devis_for_lot(ledger.lot_id)
    construction_courante = get_construction_amount(devis)
    total_bc_charges = LotBcCharge.objects.filter(lot_id=ledger.lot_id).aggregate(
        total=Sum('montant'),
    )['total'] or Decimal('0')
    return (
        ledger.prix_client - ledger.foncier_alloue - ledger.be_alloue
        - construction_courante - total_bc_charges
    )


def record_bc_charge_for_mission(*, mission, actor):
    """Effet de bord de `create_mission` (ticket 012) — ticket B-036,
    décisions 1/2/3/A/C/F/G. Appelée SYNCHRONEMENT, DANS le même bloc
    `transaction.atomic()` et sous la MÊME bascule RLS que la création de
    la mission elle-même (déjà positionnée par l'appelant sur
    l'organisation du lot) — jamais `.delay()`'d : une charge BC perdue ou
    retardée corromprait irrémédiablement le calcul de marge du
    grand-livre (donnée financière de premier ordre, pas une simple
    notification comme `Task`).

    **Ne lève JAMAIS d'exception par conception (décision 3)** : soit une
    `LotBcCharge` est créée, soit rien ne l'est — aucun chemin d'erreur
    attendu qui bloquerait la création de la mission.

    **Décision 1** : une entrée `fixed_amount` pour le `jalon_type` PRÉCIS
    de la mission → charge cumulative (une par mission qui y correspond).
    **Décision 2/C** : sinon, une entrée `percentage` sous
    `GLOBAL_CONTROL_OFFICE_JALON_TYPE`, consommée AU PLUS UNE FOIS PAR LOT
    (voir `_record_global_bc_charge_if_available`, `is_global_reference`,
    décision E). Aucune entrée applicable des deux côtés : aucune charge,
    jamais une erreur.
    """
    lot = mission.work_declaration.milestone.lot
    jalon_type = mission.work_declaration.milestone.code
    country_pack_id = lot.organization.country_pack_id

    fixed_rate = get_active_control_office_rate(country_pack_id=country_pack_id, jalon_type=jalon_type)
    if fixed_rate is not None and fixed_rate.calculation_mode == ControlOfficeCalculationMode.FIXED_AMOUNT:
        charge = LotBcCharge.objects.create(
            organization=lot.organization,
            lot=lot,
            mission=mission,
            jalon_type=jalon_type,
            montant=fixed_rate.fixed_amount,
            is_global_reference=False,
            created_by=actor,
        )
    else:
        charge = _record_global_bc_charge_if_available(
            lot=lot, jalon_type=jalon_type, actor=actor, mission=mission,
        )

    if charge is not None:
        _maybe_alert_negative_margin(lot=lot, actor=actor)
    return charge


def _record_global_bc_charge_if_available(*, lot, jalon_type, actor, mission):
    """Mode `percentage`/« global » — décisions 2/C/E/G. Consommation AU
    PLUS UNE FOIS PAR LOT, suivie par REQUÊTE sur `is_global_reference`
    (décision E) plutôt qu'un champ dédié sur `Lot`/`LotLedger`.

    **Décision G** : le pourcentage s'applique au montant construction
    courant (`get_construction_amount`), indéfinissable sans devis
    verrouillé — si le devis du lot n'est pas encore verrouillé, AUCUNE
    charge n'est créée ET l'entrée globale N'EST PAS marquée consommée
    (aucune ligne créée ici, donc `is_global_reference=True` n'existe pas
    encore pour ce lot) : elle reste disponible pour une mission
    ultérieure sur ce même lot, une fois le devis verrouillé. Découle
    naturellement de l'utilisation d'une REQUÊTE (pas un pointeur figé dès
    la première tentative) pour le suivi de consommation.
    """
    already_consumed = LotBcCharge.objects.filter(lot=lot, is_global_reference=True).exists()
    if already_consumed:
        return None

    global_rate = get_active_control_office_rate(
        country_pack_id=lot.organization.country_pack_id, jalon_type=GLOBAL_CONTROL_OFFICE_JALON_TYPE,
    )
    if global_rate is None or global_rate.calculation_mode != ControlOfficeCalculationMode.PERCENTAGE:
        return None

    devis = get_locked_devis_for_lot(lot.id)
    if devis is None:
        return None

    construction_courante = get_construction_amount(devis)
    montant = (construction_courante * global_rate.percentage / Decimal('100')).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP,
    )
    return LotBcCharge.objects.create(
        organization=lot.organization,
        lot=lot,
        mission=mission,
        jalon_type=jalon_type,
        montant=montant,
        is_global_reference=True,
        created_by=actor,
    )


def _maybe_alert_negative_margin(*, lot, actor):
    """Décision 3/I : si la marge du grand-livre de ce lot passe sous
    zéro, déclenche une `Task` `ALERT` — jamais un blocage de la mission
    ni de la charge qui vient d'être créée. Aucun `LotLedger` pour ce lot
    → rien à évaluer, retour silencieux (la marge n'a alors aucun sens,
    voir décision A).
    """
    ledger = LotLedger.objects.filter(lot=lot).first()
    if ledger is None:
        return
    if get_lot_ledger_margin(ledger) >= Decimal('0'):
        return

    # Import différé : même raison que `create_ajustement`/`create_mission`
    # (évite un cycle au chargement des tasks Celery).
    from apps.tasks.services import create_task_for_lot_ledger_margin_negative

    create_task_for_lot_ledger_margin_negative(ledger, actor)


def list_bc_charges_for_lot(*, admin_organization_id, target_organization_id, lot_id):
    """Historique COMPLET des charges BC d'un lot, chronologique — ticket
    B-036, décision J. Même schéma de bascule RLS en lecture seule que
    `get_lot_ledger`/`list_devis_for_lot_as_admin`.
    """
    set_rls_context(organization_id=target_organization_id)
    try:
        return list(LotBcCharge.objects.filter(lot_id=lot_id).order_by('created_at', 'sequence'))
    finally:
        set_rls_context(organization_id=admin_organization_id)


def create_lot_ledger(*, admin, admin_organization_id, target_organization_id, lot_id, prix_client):
    """Point d'entrée unique pour créer le grand-livre d'un lot — ticket
    B-035. L'appelant (`apps.procurement.views.LotLedgerCreateView`) a déjà
    vérifié que `admin` détient `admin_keyimmo` ; cette fonction ne
    revérifie pas ce rôle. Même schéma de bascule RLS explicite que
    `create_devis`/`create_program_cost` : `target_organization_id`
    (l'organisation du LOT) fourni EXPLICITEMENT par l'appelant.
    """
    with transaction.atomic():
        set_rls_context(organization_id=target_organization_id)
        try:
            ledger = _create_lot_ledger_row(
                admin=admin, target_organization_id=target_organization_id,
                lot_id=lot_id, prix_client=prix_client,
            )
        finally:
            set_rls_context(organization_id=admin_organization_id)
    return ledger


def _create_lot_ledger_row(*, admin, target_organization_id, lot_id, prix_client):
    """**Précondition (décision D)** : le devis du lot doit déjà être
    VERROUILLÉ — refusé explicitement (`LotDevisNotLockedError`, 409)
    sinon, AUCUNE ligne créée.

    **Snapshot foncier/BE (décision E)** : lu depuis
    `apps.programs.services.compute_lot_repartition` (ticket B-033) AU
    MOMENT de cette création, jamais recalculé après — la ligne
    correspondant à CE lot est cherchée dans la liste retournée (indexée
    par lot, jamais un objet agrégé). Appelé sous la MÊME bascule déjà
    active (`admin_organization_id=target_organization_id`, no-op) :
    passer par le service `apps.programs.services`, jamais un accès direct
    à `ProgramCost` depuis ce module — même discipline de frontière
    inter-app que `get_active_control_office_rate` (ticket B-034).
    `programs_services.NoProgramCostError`/`LotMissingSurfaceError` se
    propagent tels quels jusqu'à la vue (même famille de 409).

    **Anti-course, discipline EXPLICITE (décision B)** — vérification
    préalable, PUIS `create()` sous `transaction.atomic()`, rattrapage
    explicite d'`IntegrityError` : DIFFÉRENCE avec `_upsert_active_pointer`
    (ticket B-027) — ici, une course détectée ne bascule JAMAIS vers une
    mise à jour, elle lève `LotLedgerAlreadyExistsError` (`LotLedger` est
    immuable, pas un pointeur d'état courant).
    """
    lot = Lot.objects.filter(id=lot_id, organization_id=target_organization_id).first()
    if lot is None:
        raise ValidationError({'lot': "Lot introuvable dans l'organisation cible."})

    if LotLedger.objects.filter(lot=lot).exists():
        raise LotLedgerAlreadyExistsError(
            'Un grand-livre existe déjà pour ce lot — un seul par lot.',
        )

    if get_locked_devis_for_lot(lot.id) is None:
        raise LotDevisNotLockedError(
            'Le devis de ce lot doit être verrouillé avant de créer son grand-livre.',
        )

    repartition = programs_services.compute_lot_repartition(
        admin_organization_id=target_organization_id,
        target_organization_id=target_organization_id,
        program_id=lot.asset.program_id,
    )
    lot_share = next((entry for entry in repartition if entry['lot'].id == lot.id), None)
    if lot_share is None:
        raise programs_services.NoProgramCostError(
            'Aucun ProgramCost enregistré pour le programme de ce lot — rien à répartir.',
        )

    try:
        with transaction.atomic():
            return LotLedger.objects.create(
                organization_id=target_organization_id,
                lot=lot,
                prix_client=prix_client,
                foncier_alloue=lot_share['foncier_lot'],
                be_alloue=lot_share['be_lot'],
                created_by=admin,
            )
    except IntegrityError:
        raise LotLedgerAlreadyExistsError(
            'Un grand-livre existe déjà pour ce lot — un seul par lot.',
        )


def get_lot_ledger(*, admin_organization_id, target_organization_id, lot_id):
    """Le `LotLedger` de ce lot, `None` si aucun n'existe encore — ticket
    B-035. Même schéma de bascule RLS en lecture seule que
    `list_devis_for_lot_as_admin`.
    """
    set_rls_context(organization_id=target_organization_id)
    try:
        return LotLedger.objects.filter(lot_id=lot_id).first()
    finally:
        set_rls_context(organization_id=admin_organization_id)


def get_lot_ledger_margin_for_lot(*, admin_organization_id, target_organization_id, lot_id):
    """Grand-livre + marge disponible courante de ce lot — ticket B-035.
    Combine `get_lot_ledger`/`get_lot_ledger_margin` sous UNE SEULE bascule
    RLS (évite un aller-retour de bascule supplémentaire pour une même
    lecture — `get_lot_ledger_margin` a besoin d'être appelée sous cette
    même bascule, voir sa docstring). Retourne `(None, None)` si aucun
    grand-livre n'existe encore pour ce lot.
    """
    set_rls_context(organization_id=target_organization_id)
    try:
        ledger = LotLedger.objects.filter(lot_id=lot_id).first()
        if ledger is None:
            return None, None
        margin = get_lot_ledger_margin(ledger)
    finally:
        set_rls_context(organization_id=admin_organization_id)
    return ledger, margin


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


def search_organizations_as_admin(query):
    """`GET /api/procurement/admin/organizations/?q=` — ticket B-028.
    `organizations_organization` ne porte AUCUNE policy RLS (vérifié
    directement en base avant ce ticket, `pg_class.relrowsecurity` faux) —
    une recherche cross-organisation est donc un simple filtre applicatif,
    même schéma que `apps.backoffice.services.search_users` (ticket 011),
    aucune bascule RLS nécessaire. `query` vide : liste vide, jamais un
    dump complet de la table.
    """
    if not query:
        return Organization.objects.none()
    return Organization.objects.filter(name__icontains=query).order_by('name')[:MAX_SEARCH_RESULTS]


def _search_lots_by_name_as_admin(*, admin_organization_id, query, include_lot):
    """Mécanisme PARTAGÉ de recherche de lot par nom, cross-organisation,
    pour `admin_keyimmo` — ticket B-028, extrait en fonction PRIVÉE au
    ticket B-037 pour être réutilisé par un second critère d'inclusion
    (`search_lots_eligible_for_ledger_as_admin`) sans dupliquer la boucle
    de bascule RLS ci-dessous.

    TOUTES organisations confondues — y compris celles dont l'admin n'est
    membre d'AUCUNE, ce qu'aucune requête RLS normale ne permet ici
    (`programs_lot` est sous `FORCE ROW LEVEL SECURITY`, policy stricte
    `organization_id = current_org` — même récursion que
    `apps.backoffice.services.get_user_memberships`, ticket 011).

    **Mécanisme** : `organizations_organization` n'a aucune RLS (lecture
    libre) — on énumère donc les organisations existantes, puis on
    BASCULE le contexte RLS UNE ORGANISATION À LA FOIS pour y chercher les
    lots correspondants, en cumulant les résultats. Extension EN BOUCLE du
    même mécanisme de bascule déjà établi (`create_inspection`/
    `create_mission`/`create_devis`, tickets 005/012/022) — jamais un
    bypass RLS global, jamais une nouvelle policy.

    **Coût — limite MVP assumée et documentée explicitement (ticket
    B-028, décision A)** : `MAX_SEARCH_RESULTS` borne le nombre de
    RÉSULTATS retournés, PAS le nombre de requêtes exécutées. Une
    recherche qui ne trouve rien ou peu de correspondances continue
    d'itérer TOUTES les organisations existantes avant de répondre — le
    pire cas reste **O(nombre d'organisations)** requêtes SQL. Acceptable
    au stade actuel du projet ; aucune optimisation n'est construite ici.
    La boucle s'arrête tôt (`break`) dès que `MAX_SEARCH_RESULTS` est
    atteint — seul le CAS DÉFAVORABLE (peu/pas de résultats) paie le coût
    complet.

    **`include_lot(lot)` — critère d'inclusion PARAMÉTRÉ (ticket B-037)** :
    appelé DANS la même bascule RLS que la lecture du lot — déjà
    positionnée sur l'organisation de CE lot au moment de l'appel, aucune
    bascule supplémentaire nécessaire (même précondition que documentée
    pour `is_lot_locked` lui-même). `search_lots_as_admin` (B-028,
    exclut les lots déjà verrouillés) et
    `search_lots_eligible_for_ledger_as_admin` (B-037, exige l'inverse :
    verrouillé ET sans `LotLedger`) passent chacun leur propre prédicat.

    Restauration du contexte RLS de l'appelant dans un `finally` ENGLOBANT
    TOUTE la boucle (pas par itération) — restaurer après CHAQUE
    organisation testée serait un aller-retour inutile, seule la sortie
    (normale, via le cap atteint, ou par exception) doit restaurer le
    contexte de l'appelant.
    """
    if not query:
        return []

    results = []
    organization_ids = list(Organization.objects.values_list('id', flat=True))
    try:
        for organization_id in organization_ids:
            if len(results) >= MAX_SEARCH_RESULTS:
                break
            set_rls_context(organization_id=organization_id)
            matching_lots = Lot.objects.filter(
                name__icontains=query,
            ).select_related('organization', 'asset__program')
            for lot in matching_lots:
                if not include_lot(lot):
                    continue
                results.append(lot)
                if len(results) >= MAX_SEARCH_RESULTS:
                    break
    finally:
        set_rls_context(organization_id=admin_organization_id)

    return results


def search_lots_as_admin(*, admin, admin_organization_id, query):
    """`GET /api/procurement/admin/lots/?q=` — ticket B-028. Recherche de
    lot par nom, en préparation de `POST /api/procurement/devis/` — exclut
    les lots déjà verrouillés (décision D du ticket : la mise en
    concurrence est close, aucune nouvelle candidature possible). Mince
    wrapper autour de `_search_lots_by_name_as_admin` (extraite au ticket
    B-037) — signature ET comportement PUBLICS inchangés depuis B-028.
    """
    return _search_lots_by_name_as_admin(
        admin_organization_id=admin_organization_id, query=query,
        include_lot=lambda lot: not is_lot_locked(lot.id),
    )


def search_lots_eligible_for_ledger_as_admin(*, admin, admin_organization_id, query):
    """`GET /api/procurement/admin/lots/eligible-for-ledger/?q=` — ticket
    B-037, en préparation de `POST /api/procurement/lot-ledgers/`
    (B-035). CRITÈRE INVERSE de `search_lots_as_admin` : le devis du lot
    doit déjà être VERROUILLÉ (précondition de `create_lot_ledger`), ET
    aucun `LotLedger` ne doit encore exister pour ce lot (au plus un par
    lot, décision B du ticket B-035) — les deux critères sont mutuellement
    exclusifs par construction, jamais un simple paramètre optionnel sur
    `search_lots_as_admin`.

    Réutilise le MÊME mécanisme de recherche que B-028
    (`_search_lots_by_name_as_admin`), seul le prédicat `include_lot`
    diffère. `LotLedger.objects.filter(lot=lot).exists()` est appelé SOUS
    LA MÊME bascule RLS déjà positionnée par le mécanisme partagé — même
    précondition que `is_lot_locked`.
    """
    return _search_lots_by_name_as_admin(
        admin_organization_id=admin_organization_id, query=query,
        include_lot=lambda lot: is_lot_locked(lot.id) and not LotLedger.objects.filter(lot=lot).exists(),
    )
