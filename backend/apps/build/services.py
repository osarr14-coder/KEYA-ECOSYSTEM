"""Agrégation en lecture pour BUILD Production Control Tower (ticket 009).

Même philosophie que `apps/home/services.py` (ticket 008) : tout calcul
(retard, progression, statuts) vit ici, jamais côté frontend. Particularité
de ce ticket : le tableau « Tous les lots » doit rester utilisable au-delà
de 200 lignes (critère d'acceptation) — chaque fonction ci-dessous est donc
écrite pour tenir en un nombre de requêtes BORNÉ, indépendant du nombre de
lots de l'organisation (des requêtes `__in=` groupées, jamais une requête
par lot dans une boucle Python). Voir `apps/build/tests.py::TestQueryCount`
pour la preuve.
"""

from collections import defaultdict
from datetime import timedelta

from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, Max
from django.utils import timezone

from apps.evidence.models import Evidence, WorkDeclaration
from apps.inspections.models import Inspection, Reserve
from apps.inspections.services import OPEN_RESERVE_STATUSES
from apps.programs.models import Lot, Milestone
from apps.trust import repository as trust_repository
from apps.trust.models import TrustEvent, TrustLevel
from apps.trust.services import LEVEL_PROGRESS_FRACTION

# Heuristique assumée et documentée pour ce ticket (comme la formule de
# progression du ticket 008) — rien dans le schéma ne modélise un
# échéancier planifié (aucune date cible sur Milestone/Lot) : un lot est
# considéré « en retard » s'il n'a pas atteint son dernier jalon ET
# qu'aucune nouvelle déclaration de travaux n'y a été faite depuis plus de
# ce seuil. Constante isolée pour rester facilement ajustable.
STALE_LOT_THRESHOLD_DAYS = 14


def _lot_base_row(lot, *, label, extra=None):
    row = {
        'lot_id': str(lot.id),
        'lot_name': lot.name,
        'asset_name': lot.asset.name,
        'program_name': lot.asset.program.name,
        'label': label,
    }
    if extra:
        row.update(extra)
    return row


def _serialize_trust_event(event):
    if event is None:
        return None
    return {
        'level': event.level,
        'source': event.source,
        'actor': event.actor.email,
        'scope': event.scope,
        'created_at': event.created_at.isoformat(),
    }


def _bulk_work_declarations(lot_ids):
    """Une seule passe de requêtes groupées pour toutes les
    `WorkDeclaration` du périmètre — réutilisée par plusieurs catégories
    d'exceptions (contrôles à planifier, documents manquants) pour ne pas
    reparcourir deux fois la même donnée.

    Retourne `(declarations, evidences, evidence_ids_by_declaration_id,
    inspected_declaration_ids, inspected_evidence_ids)`.
    """
    declarations = list(
        WorkDeclaration.objects.filter(milestone__lot_id__in=lot_ids)
        .select_related('milestone', 'milestone__lot', 'milestone__lot__asset', 'milestone__lot__asset__program')
        .order_by('created_at'),
    )
    declaration_ids = [declaration.id for declaration in declarations]

    # `select_related('added_by')` : ticket 014 (friction du rapport
    # bout-en-bout) — le dropdown "Documenter une correction" de BUILD a
    # besoin de l'auteur pour différencier plusieurs preuves du même jalon
    # le même jour. Un JOIN, jamais une requête supplémentaire par preuve —
    # reste dans le nombre de requêtes BORNÉ exigé par ce ticket (voir
    # `TestAllLotsScalesToTwoHundredLots`).
    evidences = list(Evidence.objects.filter(work_declaration_id__in=declaration_ids).select_related('added_by'))
    evidence_ids_by_declaration = defaultdict(list)
    for evidence in evidences:
        evidence_ids_by_declaration[evidence.work_declaration_id].append(evidence.id)
    evidence_ids = [evidence.id for evidence in evidences]

    inspected_declaration_ids = set(
        Inspection.objects.filter(work_declaration_id__in=declaration_ids)
        .values_list('work_declaration_id', flat=True),
    )
    inspected_evidence_ids = set(
        Inspection.objects.filter(evidence_id__in=evidence_ids).values_list('evidence_id', flat=True),
    )

    return declarations, evidences, evidence_ids_by_declaration, inspected_declaration_ids, inspected_evidence_ids


def _bulk_open_reserves(organization):
    """Réserves ouvertes de l'organisation, en 2 requêtes groupées quel que
    soit le nombre de réserves — même technique `DISTINCT ON` (dernier
    `TrustEvent` par sujet) que `apps/home/services.py`, mais appliquée à
    TOUTES les réserves de l'organisation plutôt qu'à un seul lot.
    """
    reserves = list(
        Reserve.objects.filter(organization=organization)
        .select_related('lot', 'lot__asset', 'lot__asset__program'),
    )
    reserve_ids = [reserve.id for reserve in reserves]
    reserve_content_type = ContentType.objects.get_for_model(Reserve)

    latest_events = (
        TrustEvent.objects.filter(subject_type=reserve_content_type, subject_id__in=reserve_ids)
        .select_related('actor')
        .order_by('subject_id', *trust_repository.LATEST_FIRST_ORDERING)
        .distinct('subject_id')
    )
    latest_event_by_reserve_id = {event.subject_id: event for event in latest_events}

    open_reserves = []
    for reserve in reserves:
        event = latest_event_by_reserve_id.get(reserve.id)
        if event is not None and event.source in OPEN_RESERVE_STATUSES:
            open_reserves.append((reserve, event))
    return open_reserves


def get_exceptions(organization):
    """Les 5 catégories d'exceptions du ticket 009, chacune bornée en
    nombre de requêtes indépendamment du nombre de lots de l'organisation.
    """
    lots = list(
        Lot.objects.filter(organization=organization)
        .select_related('asset', 'asset__program')
        .order_by('name'),
    )
    lot_ids = [lot.id for lot in lots]

    declarations, evidences, evidence_ids_by_declaration, inspected_declaration_ids, inspected_evidence_ids = (
        _bulk_work_declarations(lot_ids)
    )
    declaration_by_id = {declaration.id: declaration for declaration in declarations}

    # Regroupe les Evidence disponibles par lot — nécessaire au frontend
    # pour l'action « Documenter une correction » d'une réserve ouverte
    # (POST /api/reserve-corrections/ exige une Evidence EXISTANTE, voir
    # apps/inspections/serializers.py::ReserveCorrectionCreateSerializer).
    # Construit ici, à partir des données déjà chargées ci-dessus — aucune
    # requête supplémentaire.
    evidence_summaries_by_lot_id = defaultdict(list)
    for evidence in evidences:
        declaration = declaration_by_id.get(evidence.work_declaration_id)
        if declaration is None:
            continue
        evidence_summaries_by_lot_id[declaration.milestone.lot_id].append({
            'id': str(evidence.id),
            'milestone_label': declaration.milestone.label,
            'created_at': evidence.created_at.isoformat(),
            # Ticket 014 (friction du rapport bout-en-bout) : plusieurs
            # preuves du même jalon soumises le même jour étaient
            # strictement indiscernables dans le dropdown de BUILD (« Foncier
            # — 16/08/2026 » répété 5 fois). L'auteur différencie
            # immédiatement, sans requête supplémentaire (voir
            # `select_related('added_by')` ci-dessus).
            'added_by_email': evidence.added_by.email,
        })

    # --- Lots en retard ---
    milestone_counts = dict(
        Milestone.objects.filter(lot_id__in=lot_ids)
        .values('lot_id').annotate(count=Count('id')).values_list('lot_id', 'count'),
    )
    declared_milestone_counts = dict(
        WorkDeclaration.objects.filter(milestone__lot_id__in=lot_ids)
        .values('milestone__lot_id').annotate(count=Count('milestone_id', distinct=True))
        .values_list('milestone__lot_id', 'count'),
    )
    latest_declaration_at = dict(
        WorkDeclaration.objects.filter(milestone__lot_id__in=lot_ids)
        .values('milestone__lot_id').annotate(latest=Max('created_at'))
        .values_list('milestone__lot_id', 'latest'),
    )

    now = timezone.now()
    threshold = now - timedelta(days=STALE_LOT_THRESHOLD_DAYS)
    lots_en_retard = []
    for lot in lots:
        total_milestones = milestone_counts.get(lot.id, 0)
        if total_milestones == 0:
            continue
        if declared_milestone_counts.get(lot.id, 0) >= total_milestones:
            continue
        reference_time = latest_declaration_at.get(lot.id) or lot.created_at
        if reference_time <= threshold:
            lots_en_retard.append(_lot_base_row(
                lot,
                label=f"Aucune nouvelle déclaration de travaux depuis le {reference_time:%d/%m/%Y}",
                extra={'reference_date': reference_time.isoformat()},
            ))

    # --- Contrôles à planifier ---
    controles_a_planifier = []
    for declaration in declarations:
        has_direct_inspection = declaration.id in inspected_declaration_ids
        has_evidence_inspection = any(
            evidence_id in inspected_evidence_ids
            for evidence_id in evidence_ids_by_declaration.get(declaration.id, [])
        )
        if not has_direct_inspection and not has_evidence_inspection:
            controles_a_planifier.append(_lot_base_row(
                declaration.milestone.lot,
                label=f"Déclaration « {declaration.milestone.label} » en attente de contrôle",
                extra={'work_declaration_id': str(declaration.id)},
            ))

    # --- Capacités manquantes ---
    capacites_manquantes = [
        _lot_base_row(lot, label='Aucune organisation constructrice affectée')
        for lot in lots if lot.assigned_organization_id is None
    ]

    # --- Réserves ouvertes ---
    reserves_ouvertes = [
        {
            **_lot_base_row(
                reserve.lot,
                label=f"Réserve ouverte — {reserve.description or 'sans description'}",
            ),
            'reserve_id': str(reserve.id),
            'status': event.source,
            'event': _serialize_trust_event(event),
            'available_evidence': evidence_summaries_by_lot_id.get(reserve.lot_id, []),
        }
        for reserve, event in _bulk_open_reserves(organization)
    ]

    # --- Documents manquants ---
    documents_manquants = [
        _lot_base_row(
            declaration.milestone.lot,
            label=f"Aucune preuve pour « {declaration.milestone.label} »",
            extra={'work_declaration_id': str(declaration.id)},
        )
        for declaration in declarations
        if not evidence_ids_by_declaration.get(declaration.id)
    ]

    return {
        'lots_en_retard': lots_en_retard,
        'controles_a_planifier': controles_a_planifier,
        'capacites_manquantes': capacites_manquantes,
        'reserves_ouvertes': reserves_ouvertes,
        'documents_manquants': documents_manquants,
    }


def build_lot_rows(organization):
    """Une ligne par `Lot` de l'organisation pour le tableau « Tous les
    lots » — mêmes requêtes groupées que `get_exceptions`, jamais une
    requête par lot. Retourne une liste de dicts déjà triable/filtrable en
    Python (voir `apps/build/views.py::AllLotsView`) : à l'échelle de ce
    MVP (une organisation, quelques centaines de lots au plus), matérialiser
    une fois puis trier/filtrer en mémoire reste largement plus rapide que
    le risque d'un N+1 SQL — le nombre de REQUÊTES, pas le travail Python,
    est ce qui détermine la vitesse perçue à cette échelle.
    """
    lots = list(
        Lot.objects.filter(organization=organization)
        .select_related('asset', 'asset__program', 'assigned_organization')
        .order_by('name'),
    )
    lot_ids = [lot.id for lot in lots]

    milestone_counts = dict(
        Milestone.objects.filter(lot_id__in=lot_ids)
        .values('lot_id').annotate(count=Count('id')).values_list('lot_id', 'count'),
    )
    declared_milestone_counts = dict(
        WorkDeclaration.objects.filter(milestone__lot_id__in=lot_ids)
        .values('milestone__lot_id').annotate(count=Count('milestone_id', distinct=True))
        .values_list('milestone__lot_id', 'count'),
    )
    open_reserves_by_lot = defaultdict(int)
    for reserve, _event in _bulk_open_reserves(organization):
        open_reserves_by_lot[reserve.lot_id] += 1

    rows = []
    for lot in lots:
        total_milestones = milestone_counts.get(lot.id, 0)
        declared_milestones = declared_milestone_counts.get(lot.id, 0)
        # Approximation de la progression pour ce tableau à forte volumétrie
        # (pas la moyenne pondérée exacte du ticket 008, coûteuse à calculer
        # en masse pour des centaines de lots) : proportion de jalons ayant
        # au moins une déclaration de travaux, sur `declare` = 20% comme
        # unité (voir LEVEL_PROGRESS_FRACTION). Documenté comme approximation
        # délibérée, pas la même précision que HOME (qui ne calcule que pour
        # UN lot à la fois).
        progress_percentage = (
            round((declared_milestones / total_milestones) * LEVEL_PROGRESS_FRACTION[TrustLevel.DECLARE])
            if total_milestones else 0
        )
        rows.append({
            'id': str(lot.id),
            'name': lot.name,
            'asset_name': lot.asset.name,
            'program_id': str(lot.asset.program_id),
            'program_name': lot.asset.program.name,
            'assigned_organization_id': (
                str(lot.assigned_organization_id) if lot.assigned_organization_id else None
            ),
            'assigned_organization_name': (
                lot.assigned_organization.name if lot.assigned_organization_id else None
            ),
            'milestone_count': total_milestones,
            'declared_milestone_count': declared_milestones,
            'progress_percentage': progress_percentage,
            'open_reserve_count': open_reserves_by_lot.get(lot.id, 0),
            'created_at': lot.created_at.isoformat(),
        })
    return rows
