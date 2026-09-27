"""Ticket B-057 — vitrine publique (page d'accueil KEYA, F-079).

Deux lectures ANONYMES, strictement en lecture seule :

- `public_offer()` : programmes ayant au moins un lot avec prix de vente,
  leurs lots DISPONIBLES (un programme entièrement réservé reste affiché,
  « complet », avec 0 lot) et le barème de paiement de leur Country Pack
  (frais de réservation + paliers légaux cumulés) — de quoi alimenter le
  simulateur ;
- `public_worksites()` : avancement des chantiers en cours (lots ayant au
  moins une déclaration de travaux), jalon par jalon.

Aucune donnée personnelle n'est exposée : ni client, ni réservation, ni
pièce, ni montant encaissé — uniquement ce que le catalogue authentifié
(B-048) montre déjà, plus l'état de contrôle des jalons.

**RLS** : une requête anonyme n'ouvre aucune transaction dans
`OrganizationScopeMiddleware` (aucun utilisateur). Ces lectures ouvrent donc
LEUR PROPRE `transaction.atomic()` : `set_config(..., true)` (SET LOCAL) n'a
d'effet qu'à l'intérieur d'une transaction, et disparaît à sa fin — aucun
contexte ne fuit vers une autre requête. Boucle de bascule par organisation,
même mécanisme que `services.list_published_lots`, mais SANS l'expiration
des blocages échus que ce dernier écrit au passage : une requête anonyme
n'écrit jamais rien.
"""

from decimal import Decimal

from django.conf import settings
from django.db import transaction

from apps.core.demo import demo_scope
from apps.core.rls import set_rls_context
from apps.evidence.models import WorkDeclaration
from apps.inspections import services as inspections_services
from apps.organizations.models import Organization
from apps.pricing.services import get_active_legal_payment_tier_template
from apps.programs.models import Lot, LotCommercialStatus

from .models import DEFAULT_CURRENCY


def _payment_schedule(country_pack_id):
    template = get_active_legal_payment_tier_template(country_pack_id) if country_pack_id else None
    return {
        'reservation_fee': str(Decimal(settings.RESERVATION_FEE_AMOUNT)),
        'steps': [
            {'code': step.code, 'label': step.label, 'cumulative_cap_percent': str(step.cumulative_cap_percent)}
            for step in (template.steps.order_by('order') if template else [])
        ],
    }


def public_offer():
    programs = {}
    with transaction.atomic():
        for organization in Organization.objects.all():
            set_rls_context(organization_id=organization.id)
            lots = (
                Lot.objects.filter(demo_scope('asset__program__'), sale_price__isnull=False)
                .select_related('asset__program')
                .order_by('asset__program__name', 'name')
            )
            for lot in lots:
                program = lot.asset.program
                entry = programs.get(program.id)
                if entry is None:
                    entry = programs[program.id] = {
                        'id': str(program.id),
                        'name': program.name,
                        # PO-2026-09-27-13 : constructeur affecté, jamais « promoteur ».
                        'constructeur': organization.name,
                        'locations': [],
                        'currency': DEFAULT_CURRENCY,
                        'lots': [],
                        'total_lots': 0,
                        'prices': [],
                        'payment_schedule': _payment_schedule(organization.country_pack_id),
                    }
                if lot.asset.location and lot.asset.location not in entry['locations']:
                    entry['locations'].append(lot.asset.location)
                entry['total_lots'] += 1
                entry['prices'].append(lot.sale_price)
                if lot.commercial_status != LotCommercialStatus.DISPONIBLE:
                    continue
                entry['lots'].append({
                    'id': str(lot.id),
                    'name': lot.name,
                    'asset': lot.asset.name,
                    'surface': str(lot.surface) if lot.surface is not None else None,
                    'price': str(lot.sale_price),
                })
    result = sorted(programs.values(), key=lambda entry: entry['name'])
    for entry in result:
        # « À partir de » : sur les lots encore disponibles, sinon sur tout le
        # programme (programme complet, prix indicatif du simulateur).
        prices = [Decimal(lot['price']) for lot in entry['lots']] or entry['prices']
        entry['available_lots'] = len(entry['lots'])
        entry['price_from'] = str(min(prices))
        del entry['prices']
    return result


def public_worksites():
    worksites = []
    with transaction.atomic():
        for organization in Organization.objects.all():
            set_rls_context(organization_id=organization.id)
            lot_ids = set(WorkDeclaration.objects.values_list('milestone__lot_id', flat=True))
            if not lot_ids:
                continue
            lots = Lot.objects.filter(demo_scope('asset__program__'), id__in=lot_ids)
            for lot in lots.select_related('asset__program').order_by('name'):
                milestones = []
                for milestone in lot.milestones.order_by('order'):
                    milestone.lot = lot
                    status = inspections_services.milestone_control_state(milestone)['status']
                    milestones.append({
                        'label': milestone.label,
                        'status': status,
                        'status_label': inspections_services.CONTROL_STATUS_LABELS[status],
                    })
                worksites.append({
                    'program': lot.asset.program.name,
                    'lot': lot.name,
                    'location': lot.asset.location,
                    'accepted': sum(1 for row in milestones if row['status'] == inspections_services.ACCEPTED),
                    'total': len(milestones),
                    'milestones': milestones,
                })
    return sorted(worksites, key=lambda row: (row['program'], row['lot']))
