from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.organizations.models import CountryPack

from .models import (
    ActiveLegalPaymentTierTemplate,
    ControlOfficeCalculationMode,
    ControlOfficeRate,
    LegalPaymentTierStep,
    LegalPaymentTierTemplate,
    PricingCanal,
    PricingConfig,
)

# Ordre canonique "plus récent d'abord" — ticket B-031 : `-created_at` seul
# est ambigu entre deux `PricingConfig` créés via deux requêtes HTTP quasi
# simultanées (voir models.py, docstring de PricingConfig, et migration
# 0005_pricingconfig_sequence.py) — `-sequence` départage de façon garantie,
# même tuple que `apps.trust.repository.LATEST_FIRST_ORDERING` (ticket 013
# bis).
LATEST_FIRST_ORDERING = ('-created_at', '-sequence')

# Ticket B-036 — valeur de `jalon_type` réservée pour l'entrée `percentage`
# qui sert de référence GLOBALE du barème bureau de contrôle d'un pays (voir
# `apps.procurement.services.record_bc_charge_for_mission`, seul
# consommateur). `jalon_type` reste un `CharField` LIBRE au niveau du
# modèle `ControlOfficeRate` (aucun changement de schéma) — cette constante
# vit ICI, pas dans `apps.procurement`, car `apps.procurement.services`
# importe déjà `apps.pricing.services`/`apps.pricing.models`
# (`get_active_rate`, `PricingCanal`), jamais l'inverse : la définir dans
# `apps.pricing` évite tout risque de cycle d'import une fois la garde
# ci-dessous posée (`create_control_office_rate` a besoin de la connaître).
GLOBAL_CONTROL_OFFICE_JALON_TYPE = 'global'


class CountryPackInactiveError(Exception):
    """Ticket B-032 — ferme la dette signalée au ticket B-030 : un
    `country_pack_id` inactif (`is_active=False`) deviné ou copié d'ailleurs
    contournait le filtre `is_active=True` appliqué côté liste
    (`GET /api/organizations/country-packs/`) et permettait quand même de
    créer un `PricingConfig`/`LegalPaymentTierTemplate` pour ce pays. Même
    famille que `apps.procurement.services.LotAlreadyLockedError`/
    `NoPricingConfigError` — 409, pas 400 : le corps de la requête est
    valide (un `country_pack_id` qui existe réellement), c'est l'ÉTAT de ce
    `CountryPack` qui rend l'opération impossible.
    """


def create_pricing_config(*, admin, country_pack_id, canal, rate):
    """Point d'entrée unique pour créer un `PricingConfig` — ticket 025.
    L'appelant (`apps.pricing.views.PricingConfigCreateView`) a déjà
    vérifié que `admin` détient `admin_keyimmo` (`IsAdminKeyimmo`, ticket
    011) ; cette fonction ne revérifie pas ce rôle.

    Aucune bascule RLS ici, contrairement à `create_devis`/`create_mission`
    (tickets 005/012/022) : `PricingConfig` n'a pas de colonne
    `organization_id`, la policy RLS `INSERT` est permissive
    (`WITH CHECK (true)`, voir migration RLS) — rien à emprunter.

    **Garde `is_active` (ticket B-032)** : refusée AVANT toute écriture,
    aucune ligne créée — voir `CountryPackInactiveError`.
    """
    country_pack = CountryPack.objects.filter(id=country_pack_id).first()
    if country_pack is None:
        raise ValidationError({'country_pack': 'Country Pack introuvable.'})
    if not country_pack.is_active:
        raise CountryPackInactiveError(
            f"Le Country Pack « {country_pack.label} » n'est pas actif — aucun taux ne peut y être créé.",
        )

    return PricingConfig.objects.create(
        country_pack=country_pack,
        canal=canal,
        rate=rate,
        created_by=admin,
    )


def get_active_rate(*, country_pack_id, canal):
    """Le `PricingConfig` ACTUEL (dernier créé, `LATEST_FIRST_ORDERING`)
    pour UN SEUL `(country_pack, canal)` — `None` si aucun n'existe encore.
    Ticket 026 : extraction dédiée à la dérivation unitaire (ex.
    `apps.procurement.services.create_devis`), distincte de
    `get_current_rates` (pensée pour un affichage `GET .../current/`, qui
    retourne les DEUX canaux à la fois).
    """
    return PricingConfig.objects.filter(
        country_pack_id=country_pack_id, canal=canal,
    ).order_by(*LATEST_FIRST_ORDERING).first()


def get_current_rates(country_pack_id):
    """Le taux ACTUEL de chaque canal pour ce `CountryPack` — le dernier
    `PricingConfig` créé (`LATEST_FIRST_ORDERING`), jamais un champ
    `is_active` basculé. Retourne un dict `{canal: PricingConfig | None}` —
    `None` si aucun `PricingConfig` n'existe encore pour ce canal (pas
    d'erreur : un `CountryPack` tout juste créé n'a légitimement encore
    aucun taux configuré). Construit sur `get_active_rate` (ticket 026),
    jamais une requête dupliquée.
    """
    return {
        canal: get_active_rate(country_pack_id=country_pack_id, canal=canal)
        for canal, _label in PricingCanal.choices
    }


def get_pricing_history(*, country_pack_id, canal):
    """Historique COMPLET d'un `(country_pack, canal)`, du plus ANCIEN au
    plus récent (lecture naturelle d'une évolution dans le temps — ordre
    INVERSE de `LATEST_FIRST_ORDERING`, qui sert à dériver le taux actuel,
    pas à afficher un historique). L'« ancien taux » d'un changement donné
    se lit en comparant deux entrées consécutives de cette liste, jamais
    un champ dédié.

    Tie-break `sequence` symétrique à `LATEST_FIRST_ORDERING` (ticket
    B-031) — cohérence complète, pas un correctif partiel : deux entrées au
    même `created_at` mal départagées resteraient un bug d'affichage, même
    moins grave qu'un mauvais taux dérivé « actif ».
    """
    return list(
        PricingConfig.objects.filter(
            country_pack_id=country_pack_id, canal=canal,
        ).order_by('created_at', 'sequence'),
    )


def create_legal_payment_tier_template(*, admin, country_pack_id, version, steps):
    """Point d'entrée unique pour créer un `LegalPaymentTierTemplate`
    BROUILLON — ticket B-027. L'appelant a déjà vérifié `admin_keyimmo`
    (`IsAdminKeyimmo`, ticket 011) ; cette fonction ne revérifie pas ce
    rôle.

    `steps` : liste de dicts `{'order', 'code', 'label',
    'cumulative_cap_percent', 'allows_progressive_payments'}`, dans
    N'IMPORTE QUEL ordre d'arrivée — cette fonction les trie elle-même par
    `order` pour la validation des plafonds cumulés ; l'ordre d'AFFICHAGE
    ultérieur, lui, ne dépend jamais de l'ordre d'insertion en base, mais
    de `LegalPaymentTierStep.Meta.ordering = ['order']`.

    **Garde de non-dépassement (cœur de ce ticket)** — validation STATIQUE
    de cohérence, jamais un contrôle de mouvement de fonds réel (aucun
    n'existe dans ce projet) : les plafonds cumulés doivent être
    STRICTEMENT croissants, et le dernier doit valoir EXACTEMENT 100.
    Refusé (`ValidationError`) AVANT toute écriture — aucune ligne créée,
    ni le template ni ses paliers (même discipline que
    `apps.procurement.services.create_devis`/`LotAlreadyLockedError`,
    ticket 022).

    **Garde `is_active` (ticket B-032)** : refusée AVANT toute écriture,
    aucune ligne créée — voir `CountryPackInactiveError`.
    """
    country_pack = CountryPack.objects.filter(id=country_pack_id).first()
    if country_pack is None:
        raise ValidationError({'country_pack': 'Country Pack introuvable.'})
    if not country_pack.is_active:
        raise CountryPackInactiveError(
            f"Le Country Pack « {country_pack.label} » n'est pas actif — "
            f"aucun palier légal ne peut y être créé.",
        )

    if not steps:
        raise ValidationError({'steps': 'Au moins un palier est requis.'})

    _validate_cumulative_caps_are_strictly_increasing_and_end_at_100(steps)

    with transaction.atomic():
        template = LegalPaymentTierTemplate.objects.create(
            country_pack=country_pack, version=version, created_by=admin,
        )
        LegalPaymentTierStep.objects.bulk_create([
            LegalPaymentTierStep(template=template, **step) for step in steps
        ])
    return template


def _validate_cumulative_caps_are_strictly_increasing_and_end_at_100(steps):
    ordered_steps = sorted(steps, key=lambda step: step['order'])
    previous_cap = Decimal('-1')
    for step in ordered_steps:
        cap = step['cumulative_cap_percent']
        if cap <= previous_cap:
            raise ValidationError({
                'steps': (
                    f"Les plafonds cumulés doivent être strictement croissants — "
                    f"le palier « {step['code']} » ({cap}%) n'est pas supérieur au précédent."
                ),
            })
        previous_cap = cap

    last_cap = ordered_steps[-1]['cumulative_cap_percent']
    if last_cap != Decimal('100'):
        raise ValidationError({
            'steps': f"Le dernier palier doit avoir un plafond cumulé de EXACTEMENT 100 (reçu : {last_cap}).",
        })


def activate_legal_payment_tier_template(*, admin, template_id):
    """Active un `LegalPaymentTierTemplate` brouillon — ticket B-027,
    décision D. Pose `activated_by`/`activated_at` UNE FOIS, jamais
    réécrits ensuite (voir docstring du modèle) ; PUIS bascule le pointeur
    `ActiveLegalPaymentTierTemplate` du `country_pack` vers CE template —
    l'ancien template actif, s'il existe, n'est JAMAIS modifié.

    **Garantie DB, pas seulement applicative (décision D-bis)** : la
    bascule du pointeur reprend la discipline anti-race EXPLICITE de
    `apps.tasks.services._get_or_create_task` (ticket 017) — `get()`
    initial, `create()` sous `transaction.atomic()`, rattrapage explicite
    d'`IntegrityError` si une activation concurrente pour le MÊME
    `country_pack` a créé le pointeur entre-temps, puis second `get()` —
    jamais un `get_or_create()`/`update_or_create()` Django (même choix que
    ticket 017 : ces raccourcis masquent la logique de course et la rendent
    plus difficile à auditer/tester explicitement), jamais un retry
    aveugle. La contrainte `UNIQUE` réelle posée par `OneToOneField` (pas
    une vérification côté service) est ce qui rend cette course détectable
    et rattrapable plutôt que de produire deux pointeurs.
    """
    template = LegalPaymentTierTemplate.objects.filter(id=template_id).first()
    if template is None:
        raise ValidationError({'template': 'LegalPaymentTierTemplate introuvable.'})

    with transaction.atomic():
        template.activated_by = admin
        template.activated_at = timezone.now()
        template.save(update_fields=['activated_by', 'activated_at'])
        _upsert_active_pointer(country_pack=template.country_pack, template=template)
    return template


def _upsert_active_pointer(*, country_pack, template):
    """Bascule le pointeur `ActiveLegalPaymentTierTemplate` de ce
    `country_pack` vers `template` — même discipline anti-race EXPLICITE
    que `_get_or_create_task` (ticket 017) : un `get()` initial, un
    `create()` sous `transaction.atomic()` si absent, et SEULEMENT si ce
    `create()` lève `IntegrityError` (une activation concurrente pour le
    MÊME `country_pack` a créé le pointeur entre-temps), un second `get()`
    explicite — jamais un `get_or_create()`/`update_or_create()` Django.

    Que le pointeur existait déjà ou vienne d'être relu après course, la
    dernière étape est toujours la même : le faire pointer vers CE
    template. Un simple `UPDATE` sur une ligne EXISTANTE — aucune course de
    duplication possible à ce stade (la contrainte `UNIQUE` ne peut plus
    être violée, la ligne existe déjà) ; PostgreSQL sérialise nativement
    deux `UPDATE` concurrents sur la même ligne, le dernier à committer
    l'emporte — comportement attendu pour un pointeur d'état COURANT, pas
    un historique.
    """
    try:
        pointer = ActiveLegalPaymentTierTemplate.objects.get(country_pack=country_pack)
    except ActiveLegalPaymentTierTemplate.DoesNotExist:
        try:
            with transaction.atomic():
                return ActiveLegalPaymentTierTemplate.objects.create(
                    country_pack=country_pack, template=template,
                )
        except IntegrityError:
            pointer = ActiveLegalPaymentTierTemplate.objects.get(country_pack=country_pack)

    pointer.template = template
    pointer.save(update_fields=['template'])
    return pointer


def get_active_legal_payment_tier_template(country_pack_id):
    """Le `LegalPaymentTierTemplate` actuellement actif pour ce
    `country_pack`, via le pointeur `ActiveLegalPaymentTierTemplate` —
    `None` si aucun n'a jamais été activé. Jamais dérivé d'un tri sur
    `activated_at` (voir décision D-bis).
    """
    pointer = ActiveLegalPaymentTierTemplate.objects.filter(country_pack_id=country_pack_id).first()
    return pointer.template if pointer else None


def get_legal_payment_tier_template_history(country_pack_id):
    """Historique COMPLET des `LegalPaymentTierTemplate` d'un
    `country_pack` (brouillons et activés), du plus ancien au plus
    récent — par `version`, jamais par `activated_at` (un brouillon n'a
    pas de date d'activation).
    """
    return list(
        LegalPaymentTierTemplate.objects.filter(
            country_pack_id=country_pack_id,
        ).order_by('version'),
    )


def create_control_office_rate(
    *, admin, country_pack_id, jalon_type, calculation_mode, percentage=None, fixed_amount=None,
):
    """Point d'entrée unique pour créer une entrée de barème sectoriel du
    bureau de contrôle (BC) — ticket B-034, invariant 25.16. **SEULE**
    fonction de tout ce projet qui crée un montant BC — voir la docstring
    de `ControlOfficeRate` pour le raisonnement complet et la note
    `CLAUDE.md` adressée aux tickets consommateurs (B-035/B-036).

    **Garde `is_active` dès la conception (décision C, ticket B-034)** —
    B-032 a fermé cette dette pour `PricingConfig`/
    `LegalPaymentTierTemplate` APRÈS coup ; ici directement, en réutilisant
    `CountryPackInactiveError` (même app, même exception).

    **Garde `jalon_type` en mode `percentage` (ticket B-036, décision
    C-bis)** — une entrée `percentage` n'est acceptée QUE pour
    `jalon_type=GLOBAL_CONTROL_OFFICE_JALON_TYPE` : `apps.procurement.
    services.record_bc_charge_for_mission` ne cherche JAMAIS une entrée
    `percentage` sous le `jalon_type` précis d'une mission, seulement sous
    cette valeur réservée — toute autre entrée `percentage` serait acceptée
    mais ne produirait jamais aucun effet.

    **Un seul des deux champs valeur actif à la fois (décision B)** —
    vérifié explicitement AVANT toute écriture (même discipline que
    `LotAlreadyLockedError`/validation des plafonds cumulés du ticket
    B-027 : refus explicite, aucune ligne créée), en PLUS du
    `CheckConstraint` posé en base (`Meta.constraints`) — cette vérification
    applicative donne un message d'erreur clair au client, la contrainte DB
    reste le filet de sécurité ultime, non contournable.
    """
    country_pack = CountryPack.objects.filter(id=country_pack_id).first()
    if country_pack is None:
        raise ValidationError({'country_pack': 'Country Pack introuvable.'})
    if not country_pack.is_active:
        raise CountryPackInactiveError(
            f"Le Country Pack « {country_pack.label} » n'est pas actif — aucun barème ne peut y être créé.",
        )

    if calculation_mode == ControlOfficeCalculationMode.PERCENTAGE:
        if percentage is None or fixed_amount is not None:
            raise ValidationError({
                'calculation_mode': (
                    "Mode 'percentage' : « percentage » est requis et « fixed_amount » doit être absent."
                ),
            })
        # Ticket B-036, décision C-bis : une entrée `percentage` sur un
        # `jalon_type` RÉEL (pas la valeur réservée) ne serait JAMAIS
        # consommée — `record_bc_charge_for_mission` ne cherche une entrée
        # `percentage` que sous `GLOBAL_CONTROL_OFFICE_JALON_TYPE`, jamais
        # sous le `jalon_type` précis d'une mission. Refusé explicitement à
        # la source plutôt qu'accepté silencieusement sans jamais produire
        # d'effet — discipline déjà appliquée à `is_active` (B-032) et à
        # l'exclusivité `percentage`/`fixed_amount` juste au-dessus.
        if jalon_type != GLOBAL_CONTROL_OFFICE_JALON_TYPE:
            raise ValidationError({
                'jalon_type': (
                    f"Mode 'percentage' : « jalon_type » doit être la valeur réservée "
                    f"« {GLOBAL_CONTROL_OFFICE_JALON_TYPE} » — une entrée percentage sur un jalon "
                    f"précis ne serait jamais appliquée."
                ),
            })
    elif calculation_mode == ControlOfficeCalculationMode.FIXED_AMOUNT:
        if fixed_amount is None or percentage is not None:
            raise ValidationError({
                'calculation_mode': (
                    "Mode 'fixed_amount' : « fixed_amount » est requis et « percentage » doit être absent."
                ),
            })
    else:
        raise ValidationError({'calculation_mode': 'Mode de calcul invalide.'})

    return ControlOfficeRate.objects.create(
        country_pack=country_pack,
        jalon_type=jalon_type,
        calculation_mode=calculation_mode,
        percentage=percentage,
        fixed_amount=fixed_amount,
        created_by=admin,
    )


def get_active_control_office_rate(*, country_pack_id, jalon_type):
    """Le `ControlOfficeRate` ACTUEL (dernier créé, `LATEST_FIRST_ORDERING`)
    pour UN SEUL `(country_pack, jalon_type)` — `None` si aucun n'existe
    encore. **Point d'entrée UNIQUE pour lire un montant bureau de
    contrôle** — voir la docstring de `ControlOfficeRate` (décision D) :
    tout futur ticket (B-035/B-036 annoncés) qui a besoin du montant BC
    d'un lot/jalon DOIT appeler cette fonction, jamais recalculer le
    pourcentage/montant lui-même ni dupliquer cette dérivation ailleurs
    dans le projet.

    Contrairement à `get_current_rates` (`PricingConfig`, ticket 026), il
    n'existe pas d'équivalent « tous les jalons à la fois » : `jalon_type`
    est une chaîne libre sans liste connue à l'avance (décision E) — les
    DEUX paramètres sont toujours requis par l'appelant.
    """
    return (
        ControlOfficeRate.objects.filter(country_pack_id=country_pack_id, jalon_type=jalon_type)
        .order_by(*LATEST_FIRST_ORDERING).first()
    )


def get_control_office_rate_history(*, country_pack_id, jalon_type):
    """Historique COMPLET d'un `(country_pack, jalon_type)`, du plus ancien
    au plus récent — tie-break `sequence` symétrique à
    `LATEST_FIRST_ORDERING`.
    """
    return list(
        ControlOfficeRate.objects.filter(country_pack_id=country_pack_id, jalon_type=jalon_type)
        .order_by('created_at', 'sequence'),
    )
