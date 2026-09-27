from rest_framework import serializers

from .models import DEFAULT_CURRENCY, Reservation


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
