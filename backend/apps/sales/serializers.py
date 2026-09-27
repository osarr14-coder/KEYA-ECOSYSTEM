from rest_framework import serializers

from .models import DEFAULT_CURRENCY, ContractVersion, CustomerReceipt, PaymentCall, PaymentCallKind, Reservation


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

    class Meta:
        model = Reservation
        fields = [
            'id', 'status', 'status_label', 'held_until', 'price_amount', 'currency',
            'lot', 'program', 'organization', 'cancellation_reason', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_lot(self, reservation):
        lot = reservation.lot
        return {'id': str(lot.id), 'name': lot.name, 'surface': str(lot.surface) if lot.surface is not None else None}

    def get_program(self, reservation):
        return {'id': str(reservation.lot.asset.program_id), 'name': reservation.lot.asset.program.name}

    def get_organization(self, reservation):
        return _organization(reservation.organization)


class AdminReservationSerializer(ReservationSerializer):
    client = serializers.SerializerMethodField()
    cancelled_by = serializers.SerializerMethodField()

    class Meta(ReservationSerializer.Meta):
        fields = ReservationSerializer.Meta.fields + ['client', 'cancelled_by']
        read_only_fields = fields

    def get_client(self, reservation):
        client = reservation.client
        return {'id': str(client.id), 'email': client.email, 'full_name': client.full_name}

    def get_cancelled_by(self, reservation):
        return reservation.cancelled_by.email if reservation.cancelled_by else None


class AdminCancelSerializer(serializers.Serializer):
    reason = serializers.CharField()


class ContractVersionSerializer(serializers.ModelSerializer):
    """Ticket B-049. `simulation: true` sur chaque version (CDC §3.1) :
    l'acte est fictif, les écrans l'affichent comme tel."""

    status_label = serializers.CharField(source='get_status_display', read_only=True)
    reservation = serializers.UUIDField(source='reservation_id', read_only=True)
    lot_name = serializers.CharField(source='reservation.lot.name', read_only=True)
    authored_by = serializers.EmailField(source='authored_by.email', read_only=True)
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

    def get_approved_by(self, contract):
        return contract.approved_by.email if contract.approved_by else None

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
    issued_by = serializers.EmailField(source='issued_by.email', read_only=True)
    reservation = serializers.UUIDField(source='reservation_id', read_only=True)
    # Ticket B-051 — calculés par le service sous le contexte RLS du lot
    # (`allocated_total`/`settled_total`), jamais ici.
    allocated_amount = serializers.SerializerMethodField()
    settled_amount = serializers.SerializerMethodField()
    settlement = serializers.SerializerMethodField()

    class Meta:
        model = PaymentCall
        fields = [
            'id', 'reservation', 'kind', 'kind_label', 'tier_code', 'tier_label', 'cumulative_cap_percent',
            'amount', 'currency', 'issued_by', 'issued_at', 'allocated_amount', 'settled_amount', 'settlement',
        ]
        read_only_fields = fields

    def get_allocated_amount(self, call):
        return _money(getattr(call, 'allocated_total', None))

    def get_settled_amount(self, call):
        return _money(getattr(call, 'settled_total', None))

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
    """Côté client : jamais l'identité du membre KEYIMMO qui a émis."""

    class Meta(PaymentCallSerializer.Meta):
        fields = [field for field in PaymentCallSerializer.Meta.fields if field != 'issued_by']
        read_only_fields = fields


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
    recorded_by = serializers.EmailField(source='recorded_by.email', read_only=True)
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

    def get_reconciled_by(self, receipt):
        return receipt.reconciled_by.email if receipt.reconciled_by else None

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
