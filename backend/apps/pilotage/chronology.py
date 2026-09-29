"""Lot 4 — chronologie d'un dossier (PO-2026-09-28-67, CDC §9.2 étape 10,
friction P17 en partie).

Reconstruit, par date serveur, ce qui est arrivé au dossier et au chantier de
son lot, à partir des trois sources qui existent déjà — aucune donnée n'est
recopiée :

- le journal des actes (`AuditEvent`) : dossier, contrat, appels de fonds,
  encaissements et leurs affectations, virements signalés, décaissements du
  lot ;
- la chaîne chantier (`TrustEvent`) : déclarations, pièces, avis, réserves ;
- les affectations de contrôle (`InspectionMission`), qui ne sont pas des
  événements de la chaîne mais un acte daté du gestionnaire.

Libellés métier, personne « organisation · rôle », jamais d'e-mail.
"""
from django.contrib.contenttypes.models import ContentType
from django.db.models import Q

from apps.audit.models import AuditEvent
from apps.core.demo import demo_scope
from apps.core.rls import set_rls_context
from apps.evidence.models import Evidence, WorkDeclaration
from apps.inspections.models import Inspection, InspectionMission, Reserve
from apps.organizations.identity import actor_parts
from apps.organizations.models import Organization
from apps.sales.models import (
    Allocation, ContractVersion, CustomerReceipt, Disbursement, PaymentCall, PaymentCallKind, PaymentNotice, Reservation,
)
from apps.trust.models import TrustEvent

SYSTEM_ACTOR = ('Plateforme', 'action automatique')

# Journal des actes : action → (libellé, rôle attendu de l'auteur).
AUDIT_LABELS = {
    'reservation.requested': ('Réservation demandée', 'client'),
    'reservation.held': ('Bien bloqué pour le client', 'client'),
    'reservation.validated': ('Dossier examiné', 'gestionnaire_adv'),
    'reservation.reserved': ('Réservation confirmée : frais encaissés', 'finance'),
    'reservation.committed': ('Dossier concrétisé : contrat signé, premier versement couvert', 'finance'),
    'reservation.cancelled': ('Réservation annulée', 'gestionnaire_adv'),
    'reservation.expired': ('Blocage expiré : bien libéré', ''),
    'contract.created': ('Contrat préparé', 'gestionnaire_adv'),
    'contract.edited': ('Contrat modifié', 'gestionnaire_adv'),
    'contract.submitted': ('Contrat soumis à approbation', 'gestionnaire_adv'),
    'contract.returned_to_draft': ('Contrat renvoyé en préparation', 'gestionnaire_adv'),
    'contract.approved': ('Contrat approuvé', 'gestionnaire_adv'),
    'contract.signed_simulated': ('Contrat signé (signature simulée)', 'client'),
    'payment_call.issued': ('Appel de fonds émis', 'gestionnaire_adv'),
    'payment_notice.declared': ('Virement signalé par le client', 'client'),
    'payment_notice.confirmed': ('Virement signalé confirmé', 'finance'),
    'payment_notice.attached': ('Virement signalé rattaché à un encaissement', 'finance'),
    'payment_notice.rejected': ('Virement signalé refusé', 'finance'),
    'receipt.recorded': ('Encaissement enregistré (simulé)', 'finance'),
    'receipt.allocated': ('Encaissement affecté à un appel de fonds', 'finance'),
    'receipt.reconciled': ('Encaissement rapproché (simulé)', 'finance'),
    'disbursement.prepared': ('Décaissement préparé', 'finance'),
    'disbursement.eligible': ('Décaissement éligible', 'finance'),
    'disbursement.eligibility_lapsed': ('Décaissement plus éligible', ''),
    'disbursement.executed': ('Décaissement exécuté (simulé)', 'finance'),
    'disbursement.beneficiary_confirmed': ('Réception confirmée par le constructeur', 'constructeur'),
    'disbursement.reconciled': ('Décaissement rapproché (simulé)', 'finance'),
    'disbursement.cancelled': ('Décaissement annulé', 'finance'),
    # Lot 5 (PO-2026-09-29-03, -04).
    'instance.archived': ('Instance archivée (lecture seule)', 'admin_keyimmo'),
    'instance.created': ('Nouvelle instance créée depuis le jeu versionné', 'admin_keyimmo'),
    'instance.retention_expired': ('Conservation de l’archive échue', 'admin_keyimmo'),
    # PO-2026-09-29-11 (T05) : écriture refusée pour un motif de droits.
    'access.denied': ('Tentative refusée (droits insuffisants)', ''),
}

# Chaîne chantier : (type de sujet, source) → (libellé, rôle attendu).
TRUST_LABELS = {
    ('workdeclaration', 'work_declaration'): ('Jalon déclaré', 'constructeur'),
    ('evidence', 'evidence_upload'): ('Pièce déposée', 'constructeur'),
    ('inspection', 'inspection_conforme'): ('Avis du contrôleur : conforme', 'inspecteur'),
    ('inspection', 'inspection_avec_reserve'): ('Avis du contrôleur : avec réserve', 'inspecteur'),
    ('reserve', 'ouverte'): ('Réserve ouverte', 'inspecteur'),
    ('reserve', 'correction_proposee'): ('Correction proposée', 'constructeur'),
    ('reserve', 'nouvelle_inspection'): ('Réserve recontrôlée', 'inspecteur'),
    ('reserve', 'levee'): ('Réserve levée', 'inspecteur'),
    ('reserve', 'maintenue'): ('Réserve maintenue', 'inspecteur'),
    ('reserve', 'rejetee'): ('Réserve close sans levée', 'inspecteur'),
}


def audit_label(action):
    """Libellé métier d'une action du journal (repli : l'action elle-même)."""
    return AUDIT_LABELS.get(action, (action, ''))[0]


def _person(user, expected_role, cache):
    if user is None:
        return SYSTEM_ACTOR
    organization, role = actor_parts(user, expected_role, cache)
    return organization or role, role if organization else ''


def _amount(value, currency='XOF'):
    try:
        number = f'{int(float(value)):,}'.replace(',', ' ')
    except (TypeError, ValueError):
        return ''
    return f'{number} {currency}'


def _audit_object(event, calls):
    payload = event.payload or {}
    if event.action == 'payment_call.issued':
        kind = PaymentCallKind(payload['kind']).label if payload.get('kind') in PaymentCallKind.values else 'Appel'
        return f"{kind} — {_amount(payload.get('amount'), payload.get('currency') or 'XOF')}"
    if event.object_type.startswith('sales.contract'):
        return f"Contrat v{payload['version']}" if payload.get('version') else 'Contrat'
    if event.action in ('receipt.recorded', 'payment_notice.confirmed', 'disbursement.executed'):
        reference = payload.get('bank_reference')
        amount = _amount(payload.get('amount'), payload.get('currency') or 'XOF')
        return ' — '.join(part for part in (amount, f'réf. {reference}' if reference else '') if part)
    if event.action == 'receipt.allocated':
        call = calls.get(payload.get('payment_call_id'))
        return f"{_amount(payload.get('amount'))} → {call}" if call else _amount(payload.get('amount'))
    if event.action == 'disbursement.prepared':
        return _amount(payload.get('amount'))
    if event.action == 'payment_notice.declared':
        return _amount(payload.get('amount'))
    return ''


def _find_reservation(reservation_id):
    for organization_id in Organization.objects.values_list('id', flat=True):
        set_rls_context(organization_id=organization_id)
        reservation = Reservation.objects.filter(
            demo_scope('lot__asset__program__'), id=reservation_id,
        ).select_related('lot', 'lot__asset__program').first()
        if reservation is not None:
            return reservation
    return None


def dossier_chronology(*, reservation_id, caller_organization_id):
    """Entrées de la chronologie, de la plus ancienne à la plus récente ;
    `None` si le dossier n'existe pas dans l'instance active."""
    cache = {}
    try:
        reservation = _find_reservation(reservation_id)
        if reservation is None:
            return None
        lot = reservation.lot
        set_rls_context(organization_id=reservation.organization_id)
        calls = {
            str(call.id): call.get_kind_display()
            for call in PaymentCall.objects.filter(reservation=reservation)
        }
        receipt_ids = list(CustomerReceipt.objects.filter(reservation=reservation).values_list('id', flat=True))
        object_ids = {reservation.id, *receipt_ids}
        object_ids.update(ContractVersion.objects.filter(reservation=reservation).values_list('id', flat=True))
        object_ids.update(PaymentCall.objects.filter(reservation=reservation).values_list('id', flat=True))
        object_ids.update(PaymentNotice.objects.filter(reservation=reservation).values_list('id', flat=True))
        object_ids.update(Allocation.objects.filter(receipt_id__in=receipt_ids).values_list('id', flat=True))

        declarations = list(WorkDeclaration.objects.filter(milestone__lot=lot).select_related('milestone'))
        milestone_of = {declaration.id: declaration.milestone.label for declaration in declarations}
        evidences = list(Evidence.objects.filter(work_declaration__in=declarations))
        piece_of = {}
        for evidence in evidences:
            milestone_of[evidence.id] = milestone_of[evidence.work_declaration_id]
            # PO-2026-09-28-63 : la pièce exigée désignée au dépôt.
            if evidence.required_piece:
                pieces = next(
                    (d.milestone.required_pieces for d in declarations if d.id == evidence.work_declaration_id), [],
                )
                piece_of[evidence.id] = next(
                    (piece.get('label') for piece in pieces or [] if piece.get('code') == evidence.required_piece), '',
                )
        inspections = list(Inspection.objects.filter(lot=lot).select_related('work_declaration', 'evidence'))
        for inspection in inspections:
            declaration_id = inspection.work_declaration_id or (inspection.evidence.work_declaration_id if inspection.evidence_id else None)
            milestone_of[inspection.id] = milestone_of.get(declaration_id, '')
        reserves = list(Reserve.objects.filter(lot=lot).select_related('opened_by_inspection'))
        for reserve in reserves:
            milestone_of[reserve.id] = milestone_of.get(reserve.opened_by_inspection_id, '')
        reserve_motif = {reserve.id: reserve.motif or reserve.description for reserve in reserves}

        subjects = Q()
        for model, rows in ((WorkDeclaration, declarations), (Evidence, evidences), (Inspection, inspections), (Reserve, reserves)):
            if rows:
                subjects |= Q(subject_type=ContentType.objects.get_for_model(model), subject_id__in=[row.id for row in rows])
        trust_events = list(
            TrustEvent.objects.filter(subjects).select_related('actor', 'subject_type').order_by('sequence'),
        ) if subjects else []
        missions = list(InspectionMission.objects.filter(work_declaration__in=declarations).select_related('assigned_by'))

        # Décaissements du lot : dans l'organisation du programme.
        disbursement_ids = set()
        audit_events = []
        for organization_id in Organization.objects.values_list('id', flat=True):
            set_rls_context(organization_id=organization_id)
            disbursement_ids.update(
                Disbursement.objects.filter(lot_id=lot.id, organization_id=organization_id).values_list('id', flat=True),
            )
        ids = object_ids | disbursement_ids
        for organization_id in Organization.objects.values_list('id', flat=True):
            set_rls_context(organization_id=organization_id)
            audit_events.extend(
                AuditEvent.objects.filter(object_id__in=ids, organization_id=organization_id).select_related('actor'),
            )

        entries = []
        for event in audit_events:
            label, role = AUDIT_LABELS.get(event.action, (event.action, ''))
            actor, actor_role = _person(event.actor, role, cache)
            object_label = _audit_object(event, calls)
            entries.append({
                'id': f'audit-{event.id}', 'at': event.created_at.isoformat(), 'action': label,
                'actor': actor, 'role': actor_role, 'justification': event.justification or '',
                'object': object_label, 'source': 'journal', 'sort': (event.created_at, 0, event.id),
            })
        for event in trust_events:
            model = event.subject_type.model
            label, role = TRUST_LABELS.get((model, event.source), (event.source, ''))
            if model == 'evidence' and piece_of.get(event.subject_id):
                label = f'{label} : {piece_of[event.subject_id]}'
            actor, actor_role = _person(event.actor, role, cache)
            milestone = milestone_of.get(event.subject_id, '')
            detail = reserve_motif.get(event.subject_id) if model == 'reserve' and event.source == 'ouverte' else ''
            entries.append({
                'id': f'trust-{event.id}', 'at': event.created_at.isoformat(), 'action': label,
                'actor': actor, 'role': actor_role, 'justification': detail or '',
                'object': f'Jalon « {milestone} »' if milestone else '', 'source': 'chantier',
                'sort': (event.created_at, 1, event.sequence),
            })
        for mission in missions:
            actor, actor_role = _person(mission.assigned_by, 'gestionnaire_adv', cache)
            inspector, _role = actor_parts(mission.assigned_inspector, 'inspecteur', cache)
            milestone = milestone_of.get(mission.work_declaration_id, '')
            entries.append({
                'id': f'mission-{mission.id}', 'at': mission.created_at.isoformat(),
                'action': f'Contrôle affecté{f" à {inspector}" if inspector else ""}',
                'actor': actor, 'role': actor_role, 'justification': '',
                'object': f'Jalon « {milestone} »' if milestone else '', 'source': 'chantier',
                'sort': (mission.created_at, 2, 0),
            })
    finally:
        set_rls_context(organization_id=caller_organization_id)
    entries.sort(key=lambda entry: entry['sort'])
    for entry in entries:
        del entry['sort']
    return {
        'reservation_id': str(reservation.id), 'lot': lot.name, 'program': lot.asset.program.name,
        'entries': entries,
    }
