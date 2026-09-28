from decimal import Decimal

from rest_framework import serializers

from apps.organizations.identity import SEPARATOR, actor_label, actor_parts

from .models import (
    DEFAULT_CURRENCY, ContractVersion, CustomerReceipt, PaymentCall, PaymentCallKind, PaymentNotice, Reservation,
    ReservationStatus,
)


def _person(user, expected_role=''):
    """PO-2026-09-28-18 / -22 : une personne s'affiche « organisation · rôle »,
    jamais par son e-mail (seule exception : Administration › Utilisateurs)."""
    return actor_label(user, expected_role) if user else None


def _client_parts(client):
    """(nom, rôle) du client : son nom et le libellé de rôle du jeu de démo
    (PO-2026-09-28-40 : « Awa Koné · Cliente fictive »), jamais son e-mail."""
    _organization, role = actor_parts(client, 'client')
    return (client.full_name or 'Client'), (role or 'Client')


def client_label(client):
    """PO-2026-09-28-34 / -40 : « Nom · rôle du jeu de démo »."""
    return SEPARATOR.join(_client_parts(client))


def _client(client):
    """Client d'un dossier : compte personnel, sans organisation affichable.
    Son nom l'identifie, jamais son e-mail (PO-2026-09-28-22, -34, -40)."""
    name, role = _client_parts(client)
    return {'id': str(client.id), 'full_name': name, 'role': role, 'label': SEPARATOR.join((name, role))}


def _money(value):
    return None if value is None else f'{value:.2f}'


def _organization(organization):
    return {'id': str(organization.id), 'name': organization.name}


class CatalogLotSerializer(serializers.Serializer):
    """`GET /api/catalog/lots/` — tout est chargé par le `select_related`
    du service : aucune requête (donc aucun contexte RLS) nécessaire ici."""

    id = serializers.UUIDField()
    name = serializers.CharField()
    surface = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    sale_price = serializers.DecimalField(max_digits=16, decimal_places=2)
    currency = serializers.SerializerMethodField()
    organization = serializers.SerializerMethodField()
    program = serializers.SerializerMethodField()
    asset = serializers.SerializerMethodField()

    def get_currency(self, lot):
        return DEFAULT_CURRENCY

    def get_organization(self, lot):
        return _organization(lot.organization)

    def get_program(self, lot):
        return {'id': str(lot.asset.program_id), 'name': lot.asset.program.name}

    def get_asset(self, lot):
        return {'id': str(lot.asset_id), 'name': lot.asset.name, 'location': lot.asset.location}


class ReservationRequestSerializer(serializers.Serializer):
    lot = serializers.UUIDField()
    organization = serializers.UUIDField()


class ReservationSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    lot = serializers.SerializerMethodField()
    program = serializers.SerializerMethodField()
    organization = serializers.SerializerMethodField()
    payment_schedule = serializers.SerializerMethodField()

    class Meta:
        model = Reservation
        fields = [
            'id', 'status', 'status_label', 'held_until', 'price_amount', 'currency',
            'lot', 'program', 'organization', 'cancellation_reason', 'validated_at', 'created_at', 'updated_at',
            'payment_schedule', 'ended_at', 'ended_by', 'hold_suspension',
        ]
        read_only_fields = fields

    hold_suspension = serializers.SerializerMethodField()

    def get_hold_suspension(self, reservation):
        """PO-2026-09-28-57 — pourquoi l'échéance d'un blocage ne s'applique
        plus : `receipt` (encaissement enregistré, revue Finance, CDC §6.1)
        ou `notice_declared` (virement signalé en cours de vérification par
        Finance) ; `null` sinon. Même règle que `_expire_if_overdue`."""
        from .models import PaymentNoticeStatus

        if reservation.status != ReservationStatus.HELD:
            return None
        if reservation.receipts.exists():
            return 'receipt'
        if reservation.payment_notices.filter(status=PaymentNoticeStatus.DECLARED).exists():
            return 'notice_declared'
        return None

    ended_at = serializers.SerializerMethodField()
    ended_by = serializers.SerializerMethodField()

    def get_ended_at(self, reservation):
        """PO-2026-09-28-43 : date serveur de l'annulation ou de l'expiration.
        Dossiers antérieurs au champ : date de la dernière mise à jour, qui
        est celle de la sortie (plus aucune écriture ensuite)."""
        if reservation.status not in (ReservationStatus.CANCELLED, ReservationStatus.EXPIRED):
            return None
        return (reservation.ended_at or reservation.updated_at).isoformat()

    def get_ended_by(self, reservation):
        """Qui a mis fin au blocage, lisible par le client sans e-mail ni nom
        de personne (PO-2026-09-28-18) : `{kind, label}`, `kind` =
        `expired` (échéance atteinte), `client` (lui-même) ou `team`
        (« organisation · rôle »)."""
        if reservation.status == ReservationStatus.EXPIRED:
            return {'kind': 'expired', 'label': None}
        if reservation.status != ReservationStatus.CANCELLED:
            return None
        if reservation.cancelled_by_id is None or reservation.cancelled_by_id == reservation.client_id:
            return {'kind': 'client', 'label': None}
        return {'kind': 'team', 'label': _person(reservation.cancelled_by, 'gestionnaire_adv')}

    def get_lot(self, reservation):
        lot = reservation.lot
        return {'id': str(lot.id), 'name': lot.name, 'surface': str(lot.surface) if lot.surface is not None else None}

    def get_program(self, reservation):
        return {'id': str(reservation.lot.asset.program_id), 'name': reservation.lot.asset.program.name}

    def get_organization(self, reservation):
        return _organization(reservation.organization)

    def get_payment_schedule(self, reservation):
        # Audit UI R1 (C03, C04, C06) — échéancier fictif du contrat.
        from .services import payment_schedule

        schedule = payment_schedule(reservation)
        if schedule is None:
            return None
        return {
            'version': schedule['version'],
            'legally_validated': schedule['legally_validated'],
            'country_pack': schedule['country_pack'],
            'first_payment_amount': str(schedule['first_payment_amount']),
            'rows': [
                {
                    'code': row['code'], 'label': row['label'], 'amount': str(row['amount']),
                    'fee_included': str(row['fee_included']) if row['fee_included'] is not None else None,
                    'cumulative_cap_percent': str(row['cumulative_cap_percent']), 'condition': row['condition'],
                    'requires_technical_acceptance': row.get('requires_technical_acceptance', False),
                    'planned_on': row['planned_on'].isoformat(),
                }
                for row in schedule['rows']
            ],
        }


class AdminReservationSerializer(ReservationSerializer):
    client = serializers.SerializerMethodField()
    worksite = serializers.SerializerMethodField()
    cancelled_by = serializers.SerializerMethodField()

    class Meta(ReservationSerializer.Meta):
        fields = ReservationSerializer.Meta.fields + ['client', 'cancelled_by', 'validated_by', 'worksite']
        read_only_fields = fields

    validated_by = serializers.SerializerMethodField()

    def get_validated_by(self, reservation):
        return _person(reservation.validated_by, 'gestionnaire_adv')

    def get_client(self, reservation):
        return _client(reservation.client)

    def get_cancelled_by(self, reservation):
        return _person(reservation.cancelled_by)

    def get_worksite(self, reservation):
        # PO-2026-09-28-27 : calculé par `list_reservations_as_admin`.
        return getattr(reservation, 'worksite_gauge', None)


class AdminCancelSerializer(serializers.Serializer):
    reason = serializers.CharField()


class ContractVersionSerializer(serializers.ModelSerializer):
    """Ticket B-049. `simulation: true` sur chaque version (CDC §3.1) :
    l'acte est fictif, les écrans l'affichent comme tel."""

    status_label = serializers.CharField(source='get_status_display', read_only=True)
    reservation = serializers.UUIDField(source='reservation_id', read_only=True)
    lot_name = serializers.CharField(source='reservation.lot.name', read_only=True)
    authored_by = serializers.SerializerMethodField()
    approved_by = serializers.SerializerMethodField()
    simulation = serializers.SerializerMethodField()

    class Meta:
        model = ContractVersion
        fields = [
            'id', 'reservation', 'lot_name', 'version', 'status', 'status_label', 'content',
            'authored_by', 'submitted_at', 'approved_by', 'approved_at', 'signed_at',
            'simulation', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_authored_by(self, contract):
        return _person(contract.authored_by, 'gestionnaire_adv')

    def get_approved_by(self, contract):
        return _person(contract.approved_by, 'gestionnaire_adv')

    def get_simulation(self, contract):
        return True


class ContractContentSerializer(serializers.Serializer):
    content = serializers.CharField(trim_whitespace=True)


class ContractTransitionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=['submit', 'back_to_draft', 'approve'])


class PaymentCallSerializer(serializers.ModelSerializer):
    """Ticket B-050 — un appel de fonds émis. Montant en chaîne (format
    `DecimalField`), jamais recalculé côté frontend."""

    kind_label = serializers.CharField(source='get_kind_display', read_only=True)
    issued_by = serializers.SerializerMethodField()
    reservation = serializers.UUIDField(source='reservation_id', read_only=True)
    # Ticket B-051 — calculés par le service sous le contexte RLS du lot
    # (`allocated_total`/`settled_total`), jamais ici.
    allocated_amount = serializers.SerializerMethodField()
    settled_amount = serializers.SerializerMethodField()
    settlement = serializers.SerializerMethodField()
    remaining_amount = serializers.SerializerMethodField()

    class Meta:
        model = PaymentCall
        fields = [
            'id', 'reservation', 'kind', 'kind_label', 'tier_code', 'tier_label', 'cumulative_cap_percent',
            'amount', 'currency', 'issued_by', 'issued_at', 'allocated_amount', 'settled_amount', 'settlement',
            'remaining_amount',
        ]
        read_only_fields = fields


    def get_issued_by(self, call):
        return _person(call.issued_by, 'gestionnaire_adv')
    def get_allocated_amount(self, call):
        return _money(getattr(call, 'allocated_total', None))

    def get_settled_amount(self, call):
        return _money(getattr(call, 'settled_total', None))

    def get_remaining_amount(self, call):
        """PO-2026-09-28-43 (P27) : reste à verser, calculé ici sur les seuls
        encaissements rapprochés et affectés (jamais par le frontend)."""
        settled = getattr(call, 'settled_total', None)
        if settled is None:
            return None
        return _money(max(call.amount - settled, 0))

    def get_settlement(self, call):
        """`to_pay` / `partial` / `settled` — couvert seulement par des
        encaissements RAPPROCHÉS (CDC §6.1) ; un versement partiel ne solde
        pas l'appel (T12)."""
        settled = getattr(call, 'settled_total', None)
        if settled is None:
            return None
        if settled >= call.amount:
            return 'settled'
        return 'partial' if settled > 0 else 'to_pay'


class ClientPaymentCallSerializer(PaymentCallSerializer):
    """Côté client : jamais l'identité du membre KEYIMMO qui a émis.

    Ticket B-056 — instructions de virement (compte FICTIF, référence propre
    à l'appel) et état de la dernière déclaration du client (`notice`)."""

    payment_reference = serializers.SerializerMethodField()
    payment_instructions = serializers.SerializerMethodField()
    notice = serializers.SerializerMethodField()

    class Meta(PaymentCallSerializer.Meta):
        fields = [field for field in PaymentCallSerializer.Meta.fields if field != 'issued_by'] + [
            'payment_reference', 'payment_instructions', 'notice',
        ]
        read_only_fields = fields

    def get_payment_reference(self, call):
        from .services import payment_reference

        return payment_reference(call)

    def get_payment_instructions(self, call):
        from .services import DEMO_BANK_INSTRUCTIONS

        return {**DEMO_BANK_INSTRUCTIONS, 'simulation': True}

    def get_notice(self, call):
        notice = getattr(call, 'latest_notice', None)
        if notice is None:
            return None
        return {
            'id': str(notice.id), 'status': notice.status, 'status_label': notice.get_status_display(),
            'amount': _money(notice.amount), 'client_reference': notice.client_reference,
            'paid_on': notice.paid_on.isoformat(), 'rejection_reason': notice.rejection_reason,
        }


class PaymentCallCandidateSerializer(serializers.Serializer):
    """Prochain appel de chaque nature, calculé par le serveur, avec la
    raison s'il n'est pas émissible."""

    kind = serializers.CharField()
    kind_label = serializers.SerializerMethodField()
    tier_code = serializers.CharField(allow_blank=True)
    tier_label = serializers.CharField(allow_blank=True)
    cumulative_cap_percent = serializers.DecimalField(max_digits=5, decimal_places=2, allow_null=True)
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)
    available = serializers.SerializerMethodField()
    reason = serializers.CharField(allow_null=True)

    def get_kind_label(self, candidate):
        return PaymentCallKind(candidate['kind']).label

    def get_available(self, candidate):
        return candidate['reason'] is None


class PaymentCallIssueSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=PaymentCallKind.choices)
    tier_code = serializers.CharField(required=False, allow_blank=True, default='')


class AllocationSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    payment_call = serializers.UUIDField(source='payment_call_id')
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)
    created_at = serializers.DateTimeField()


class CustomerReceiptSerializer(serializers.ModelSerializer):
    """Ticket B-051. `simulation: true` : aucun fonds réel (CDC §3.1)."""

    status_label = serializers.CharField(source='get_status_display', read_only=True)
    recorded_by = serializers.SerializerMethodField()
    reconciled_by = serializers.SerializerMethodField()
    unallocated_amount = serializers.SerializerMethodField()
    allocations = AllocationSerializer(many=True, read_only=True)
    simulation = serializers.SerializerMethodField()

    class Meta:
        model = CustomerReceipt
        fields = [
            'id', 'bank_reference', 'amount', 'currency', 'received_on', 'status', 'status_label',
            'recorded_by', 'recorded_at', 'reconciled_by', 'reconciled_at', 'unallocated_amount',
            'allocations', 'simulation',
        ]
        read_only_fields = fields

    def get_recorded_by(self, receipt):
        return _person(receipt.recorded_by, 'finance')

    def get_reconciled_by(self, receipt):
        return _person(receipt.reconciled_by, 'finance')

    def get_unallocated_amount(self, receipt):
        return _money(getattr(receipt, 'unallocated_total', None))

    def get_simulation(self, receipt):
        return True


class ReceiptCreateSerializer(serializers.Serializer):
    bank_reference = serializers.CharField(max_length=64)
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)
    received_on = serializers.DateField()


class AllocationCreateSerializer(serializers.Serializer):
    payment_call = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)


# ─── Décaissements — ticket B-052 ──────────────────────────────────────────


def balance_payload(balance):
    return {
        'received': _money(balance['received']), 'executed': _money(balance['executed']),
        'reserved': _money(balance['reserved']), 'available': _money(balance['available']),
        'currency': balance['currency'], 'simulation': True,
    }


def _email(user):
    """PO-2026-09-28-22 : plus jamais l'e-mail — « organisation · rôle »."""
    return _person(user, 'finance')


class DisbursementSerializer(serializers.Serializer):
    """Toutes les relations sont préchargées par le service (lues sous le
    contexte RLS du programme) : aucune requête ici. `simulation: true` :
    aucun fonds réel (CDC §3.1). `beneficiary_confirmation` : `absent` reste
    visible même après un rapprochement motivé (CDC §8.3, T11)."""

    id = serializers.UUIDField()
    organization = serializers.SerializerMethodField()
    program = serializers.SerializerMethodField()
    lot = serializers.SerializerMethodField()
    milestone = serializers.SerializerMethodField()
    beneficiary_organization = serializers.SerializerMethodField()
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)
    currency = serializers.CharField()
    status = serializers.CharField()
    status_label = serializers.CharField(source='get_status_display')
    flow_status = serializers.CharField()
    flow_status_label = serializers.CharField(source='get_flow_status_display')
    bank_reference = serializers.CharField(allow_null=True)
    executed_on = serializers.DateField(allow_null=True)
    executed_at = serializers.DateTimeField(allow_null=True)
    executed_by = serializers.SerializerMethodField()
    beneficiary_confirmation = serializers.SerializerMethodField()
    beneficiary_confirmed_at = serializers.DateTimeField(allow_null=True)
    reconciled_at = serializers.DateTimeField(allow_null=True)
    reconciled_by = serializers.SerializerMethodField()
    reconciliation_reason = serializers.CharField()
    cancel_reason = serializers.CharField()
    cancelled_at = serializers.DateTimeField(allow_null=True)
    eligible_at = serializers.DateTimeField(allow_null=True)
    prepared_by = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField()
    simulation = serializers.SerializerMethodField()

    def get_organization(self, disbursement):
        return _organization(disbursement.organization)

    def get_program(self, disbursement):
        return {'id': str(disbursement.program_id), 'name': disbursement.program.name}

    def get_lot(self, disbursement):
        return {'id': str(disbursement.lot_id), 'name': disbursement.lot.name}

    def get_milestone(self, disbursement):
        milestone = disbursement.milestone
        return {'id': str(milestone.id), 'code': milestone.code, 'label': milestone.label}

    def get_beneficiary_organization(self, disbursement):
        return _organization(disbursement.beneficiary_organization)

    def get_executed_by(self, disbursement):
        return _email(disbursement.executed_by)

    def get_reconciled_by(self, disbursement):
        return _email(disbursement.reconciled_by)

    def get_prepared_by(self, disbursement):
        return _email(disbursement.prepared_by)

    def get_beneficiary_confirmation(self, disbursement):
        if disbursement.status != 'executed_sim':
            return None
        return 'confirmed' if disbursement.beneficiary_confirmed_at else 'absent'

    def get_simulation(self, disbursement):
        return True


class DisbursementCreateSerializer(serializers.Serializer):
    milestone = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)


class DisbursementExecuteSerializer(serializers.Serializer):
    bank_reference = serializers.CharField(max_length=64)
    executed_on = serializers.DateField()


class DisbursementReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default='')


# ─── Avis de paiement — ticket B-056 ───────────────────────────────────────


class PaymentNoticeDeclareSerializer(serializers.Serializer):
    client_reference = serializers.CharField(max_length=64)
    paid_on = serializers.DateField()


class PaymentNoticeConfirmSerializer(serializers.Serializer):
    # Audit UI R1 (F02) : référence du relevé bancaire simulé, obligatoire et
    # distincte de la référence indiquée par le client. PO-2026-09-28-10 :
    # montant reçu obligatoire, lu au relevé (jamais recopié du
    # signalement) — un écart reste visible (T12).
    bank_reference = serializers.CharField(max_length=64)
    received_on = serializers.DateField(required=False, allow_null=True, default=None)
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)


class PaymentNoticeAttachSerializer(serializers.Serializer):
    # PO-2026-09-28-02 : encaissement déjà enregistré, même dossier.
    receipt = serializers.UUIDField()


class PaymentNoticeRejectSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


class PaymentNoticeSerializer(serializers.Serializer):
    """Relations préchargées par le service (contexte RLS du lot)."""

    id = serializers.UUIDField()
    organization = serializers.SerializerMethodField()
    program = serializers.SerializerMethodField()
    lot = serializers.SerializerMethodField()
    reservation = serializers.SerializerMethodField()
    client = serializers.SerializerMethodField()
    payment_call = serializers.SerializerMethodField()
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)
    currency = serializers.CharField()
    client_reference = serializers.CharField()
    paid_on = serializers.DateField()
    status = serializers.CharField()
    status_label = serializers.CharField(source='get_status_display')
    created_at = serializers.DateTimeField()
    processed_by = serializers.SerializerMethodField()
    processed_at = serializers.DateTimeField(allow_null=True)
    rejection_reason = serializers.CharField()
    simulation = serializers.SerializerMethodField()
    receipt = serializers.SerializerMethodField()

    def get_organization(self, notice):
        return _organization(notice.organization)

    def get_program(self, notice):
        program = notice.reservation.lot.asset.program
        return {'id': str(program.id), 'name': program.name}

    def get_lot(self, notice):
        return {'id': str(notice.reservation.lot_id), 'name': notice.reservation.lot.name}

    def get_reservation(self, notice):
        reservation = notice.reservation
        return {'id': str(reservation.id), 'status': reservation.status, 'status_label': reservation.get_status_display()}

    def get_client(self, notice):
        return _client(notice.client)

    def get_payment_call(self, notice):
        call = notice.payment_call
        return {
            'id': str(call.id), 'kind': call.kind, 'kind_label': call.get_kind_display(),
            'tier_label': call.tier_label, 'amount': _money(call.amount),
        }

    def get_processed_by(self, notice):
        return _person(notice.processed_by, 'finance')

    def get_simulation(self, notice):
        return True

    attachable_receipts = serializers.SerializerMethodField()

    def get_attachable_receipts(self, notice):
        """PO-2026-09-28-02 — encaissements déjà enregistrés sur le même
        dossier, candidats au rattachement (préchargés sous le contexte RLS
        du lot)."""
        if notice.status != 'declared':
            return []
        return [
            {
                'id': str(receipt.id), 'bank_reference': receipt.bank_reference, 'amount': _money(receipt.amount),
                'currency': receipt.currency, 'received_on': receipt.received_on.isoformat(),
            }
            for receipt in sorted(notice.reservation.receipts.all(), key=lambda receipt: receipt.recorded_at)
        ]

    def get_receipt(self, notice):
        """Audit UI R1 (F01, F02) — l'encaissement simulé qui fait foi :
        justificatif fictif (référence bancaire, date, montant), état CDC
        §8.3, affectations et montant non affecté. Relations préchargées sous
        le contexte RLS du lot."""
        receipt = notice.receipt
        if receipt is None:
            return None
        return receipt_proof(receipt)


def receipt_proof(receipt):
    """Justificatif fictif d'un encaissement (relations préchargées)."""
    allocations = list(receipt.allocations.all())
    allocated = sum((allocation.amount for allocation in allocations), Decimal('0'))
    return {
        'id': str(receipt.id),
        'bank_reference': receipt.bank_reference,
        'amount': _money(receipt.amount),
        'currency': receipt.currency,
        'received_on': receipt.received_on.isoformat(),
        'status': receipt.status,
        'status_label': receipt.get_status_display(),
        'recorded_by': _person(receipt.recorded_by, 'finance'),
        'recorded_at': receipt.recorded_at.isoformat(),
        'reconciled_at': receipt.reconciled_at.isoformat() if receipt.reconciled_at else None,
        'allocations': [
            {
                'id': str(allocation.id),
                'payment_call': allocation.payment_call.get_kind_display(),
                'amount': _money(allocation.amount),
            }
            for allocation in allocations
        ],
        'unallocated_amount': _money(receipt.amount - allocated),
    }


class FinanceReceiptSerializer(serializers.Serializer):
    """PO-2026-09-28-01 — encaissement enregistré, vue Finance : justificatif
    fictif, dossier et signalements rattachés (relations préchargées sous le
    contexte RLS du lot, `services.list_receipts`)."""

    def to_representation(self, receipt):
        reservation = receipt.reservation
        client = reservation.client
        return {
            **receipt_proof(receipt),
            'simulation': True,
            'organization_id': str(receipt.organization_id),
            'program': {'id': str(reservation.lot.asset.program_id), 'name': reservation.lot.asset.program.name},
            'lot': {'id': str(reservation.lot_id), 'name': reservation.lot.name},
            'reservation': {'id': str(reservation.id), 'status': reservation.status,
                            'status_label': reservation.get_status_display()},
            'client': _client(client),
            'notices': [
                {'id': str(notice.id), 'client_reference': notice.client_reference, 'status': notice.status,
                 'status_label': notice.get_status_display()}
                for notice in receipt.payment_notices.all()
            ],
        }
