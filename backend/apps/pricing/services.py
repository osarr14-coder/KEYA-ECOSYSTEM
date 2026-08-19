from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.organizations.models import CountryPack

from .models import (
    ActiveLegalPaymentTierTemplate,
    LegalPaymentTierStep,
    LegalPaymentTierTemplate,
    PricingCanal,
    PricingConfig,
)

# Ordre canonique "plus récent d'abord" — pas de colonne `sequence` ici
# (voir models.py, docstring de PricingConfig) : `-created_at` seul
# suffit, un seul enregistrement créé par appel de service, jamais deux
# dans la même transaction.
LATEST_FIRST_ORDERING = ('-created_at',)


def create_pricing_config(*, admin, country_pack_id, canal, rate):
    """Point d'entrée unique pour créer un `PricingConfig` — ticket 025.
    L'appelant (`apps.pricing.views.PricingConfigCreateView`) a déjà
    vérifié que `admin` détient `admin_keyimmo` (`IsAdminKeyimmo`, ticket
    011) ; cette fonction ne revérifie pas ce rôle.

    Aucune bascule RLS ici, contrairement à `create_devis`/`create_mission`
    (tickets 005/012/022) : `PricingConfig` n'a pas de colonne
    `organization_id`, la policy RLS `INSERT` est permissive
    (`WITH CHECK (true)`, voir migration RLS) — rien à emprunter.
    """
    country_pack = CountryPack.objects.filter(id=country_pack_id).first()
    if country_pack is None:
        raise ValidationError({'country_pack': 'Country Pack introuvable.'})

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
    """
    return list(
        PricingConfig.objects.filter(
            country_pack_id=country_pack_id, canal=canal,
        ).order_by('created_at'),
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
    """
    country_pack = CountryPack.objects.filter(id=country_pack_id).first()
    if country_pack is None:
        raise ValidationError({'country_pack': 'Country Pack introuvable.'})

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
