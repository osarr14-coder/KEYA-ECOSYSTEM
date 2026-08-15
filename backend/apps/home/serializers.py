from rest_framework import serializers

from apps.programs.models import Lot


class MyLotSerializer(serializers.ModelSerializer):
    """Un lot dans la liste `GET /api/me/lots/` — sert de sélecteur si un
    client possède plusieurs biens.
    """

    asset_name = serializers.CharField(source='asset.name', read_only=True)
    asset_location = serializers.CharField(source='asset.location', read_only=True)
    program_name = serializers.CharField(source='asset.program.name', read_only=True)

    class Meta:
        model = Lot
        fields = ['id', 'name', 'asset_name', 'asset_location', 'program_name']
