from django.core.exceptions import ValidationError

from apps.organizations.models import CountryPack

from .models import PricingCanal, PricingConfig

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
