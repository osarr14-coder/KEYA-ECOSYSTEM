from rest_framework import serializers

from .models import CountryPack


class CountryPackListSerializer(serializers.ModelSerializer):
    """Réponse de `GET /api/organizations/country-packs/` — ticket B-030.
    `code` inclus en plus de `id`/`label` (décision B, écart volontaire par
    rapport au scope initial du ticket) — utile pour un affichage du type
    « Sénégal (SN) » côté sélecteur frontend, coût nul à exposer.
    `is_active` n'est PAS exposé : tout élément listé EST actif par
    construction du filtre côté vue (décision A), pas besoin de le
    répéter dans la réponse.
    """

    class Meta:
        model = CountryPack
        fields = ['id', 'label', 'code']
        read_only_fields = fields
