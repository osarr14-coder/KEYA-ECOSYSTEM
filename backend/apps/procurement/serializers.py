from rest_framework import serializers

from . import services
from .models import Devis


class DevisCreateSerializer(serializers.Serializer):
    """Entrée de `POST /api/procurement/devis/` — `organization` est
    l'organisation du LOT (cible de la bascule RLS), jamais celle du
    candidat. Voir `apps.procurement.services.create_devis`.
    """

    organization = serializers.UUIDField()
    lot = serializers.UUIDField()
    candidate_organization = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)


class DevisAdminSerializer(serializers.ModelSerializer):
    """Réponse admin_keyimmo — SEUL serializer de ce module à exposer
    `amount`. Jamais réutilisé pour une réponse candidat (voir
    `DevisCandidateSerializer`).

    Nécessite `context={'request': request}` — `get_status` doit connaître
    l'organisation active RÉELLE de l'appelant pour restaurer correctement
    le contexte RLS après sa propre bascule interne (voir
    `apps.procurement.services.get_devis_status`).
    """

    status = serializers.SerializerMethodField()

    class Meta:
        model = Devis
        fields = [
            'id', 'organization', 'candidate_organization', 'lot',
            'amount', 'logged_by', 'created_at', 'status',
        ]
        read_only_fields = fields

    def get_status(self, obj):
        request = self.context['request']
        restore_organization_id = request.organization.id if request.organization else None
        return services.get_devis_status(obj, restore_organization_id=restore_organization_id)


class DevisCandidateSerializer(serializers.ModelSerializer):
    """Réponse candidat constructeur — **aucun champ `amount`, jamais**
    (décision de conception ticket 022 : aucun montant exposé à ce rôle,
    même le sien). N'hérite délibérément PAS de `DevisAdminSerializer`
    (ni via `exclude`) : une liste `fields` EXPLICITE, positive, est plus
    sûre qu'une exclusion — un futur champ ajouté à `Devis` n'est jamais
    exposé par accident ici, il faudrait l'ajouter consciemment à cette
    liste.

    Nécessite `context={'request': request}`, même raison que
    `DevisAdminSerializer`.
    """

    status = serializers.SerializerMethodField()

    class Meta:
        model = Devis
        fields = ['id', 'lot', 'organization', 'created_at', 'status']
        read_only_fields = fields

    def get_status(self, obj):
        request = self.context['request']
        restore_organization_id = request.organization.id if request.organization else None
        return services.get_devis_status(obj, restore_organization_id=restore_organization_id)
