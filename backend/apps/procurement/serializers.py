from rest_framework import serializers

from . import services
from .models import Devis, DevisAjustement


class DevisCreateSerializer(serializers.Serializer):
    """Entrée de `POST /api/procurement/devis/` — `organization` est
    l'organisation du LOT (cible de la bascule RLS), jamais celle du
    candidat. Voir `apps.procurement.services.create_devis`.

    **`marge_estimee` n'est PLUS un champ d'entrée depuis le ticket 026** —
    dérivé exclusivement du `PricingConfig` actif (ticket 025), aucun
    override possible même par `admin_keyimmo` (invariant 25.10/25.15,
    CLAUDE.md). Un client qui enverrait encore ce champ (code non mis à
    jour) n'obtient pas d'erreur : DRF ignore silencieusement tout champ
    non déclaré dans un serializer, comportement standard, pas un cas
    spécial à gérer ici.
    """

    organization = serializers.UUIDField()
    lot = serializers.UUIDField()
    candidate_organization = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)


class DevisAdminSerializer(serializers.ModelSerializer):
    """Réponse admin_keyimmo — SEUL serializer de ce module à exposer
    `amount`/`marge_estimee`. Jamais réutilisé pour une réponse candidat
    (voir `DevisCandidateSerializer`).

    Nécessite `context={'request': request}` — `get_status` doit connaître
    l'organisation active RÉELLE de l'appelant pour restaurer correctement
    le contexte RLS après sa propre bascule interne (voir
    `apps.procurement.services.get_devis_status`). `get_status` ici reste
    le statut RÉEL (`get_devis_status`, jamais gaté par une réconciliation)
    — un admin a besoin de savoir immédiatement qu'un devis est verrouillé,
    y compris avant tout ajustement (voir `DevisCandidateSerializer` pour
    le statut GATÉ exposé au candidat, ticket 023).
    """

    status = serializers.SerializerMethodField()

    class Meta:
        model = Devis
        fields = [
            'id', 'organization', 'candidate_organization', 'lot',
            'amount', 'marge_estimee', 'logged_by', 'created_at', 'status',
        ]
        read_only_fields = fields

    def get_status(self, obj):
        request = self.context['request']
        restore_organization_id = request.organization.id if request.organization else None
        return services.get_devis_status(obj, restore_organization_id=restore_organization_id)


class DevisCandidateSerializer(serializers.ModelSerializer):
    """Réponse candidat constructeur — **aucun champ `amount`/`marge_estimee`,
    jamais** (décision de conception ticket 022 : aucun montant exposé à ce
    rôle, même le sien). N'hérite délibérément PAS de `DevisAdminSerializer`
    (ni via `exclude`) : une liste `fields` EXPLICITE, positive, est plus
    sûre qu'une exclusion — un futur champ ajouté à `Devis` n'est jamais
    exposé par accident ici, il faudrait l'ajouter consciemment à cette
    liste.

    Nécessite `context={'request': request}`, même raison que
    `DevisAdminSerializer`.

    **`get_status` GATÉ par la réconciliation (ticket 023, correctif d'un
    bug réel du ticket 022)** — appelle `get_candidate_visible_devis_status`,
    PAS `get_devis_status` : un devis verrouillé sans aucun `DevisAjustement`
    accepté reste affiché `'candidat'` au candidat, jamais `'devis_verrouille'`
    prématurément. Voir `apps.procurement.services.
    get_candidate_visible_devis_status` pour le détail complet.
    """

    status = serializers.SerializerMethodField()

    class Meta:
        model = Devis
        fields = ['id', 'lot', 'organization', 'created_at', 'status']
        read_only_fields = fields

    def get_status(self, obj):
        request = self.context['request']
        restore_organization_id = request.organization.id if request.organization else None
        return services.get_candidate_visible_devis_status(
            obj, restore_organization_id=restore_organization_id,
        )


class DevisAjustementCreateSerializer(serializers.Serializer):
    """Entrée de `POST /api/procurement/devis/{id}/ajustements/` —
    `organization` est l'organisation du LOT (cible de la bascule RLS),
    même conséquence assumée que `DevisCreateSerializer`. `ecart` est
    SIGNÉ (positif = défavorable, négatif = favorable, ticket 023, point A).
    """

    organization = serializers.UUIDField()
    ecart = serializers.DecimalField(max_digits=14, decimal_places=2)


class DevisAjustementAdminSerializer(serializers.ModelSerializer):
    """Réponse admin_keyimmo — seule audience de `DevisAjustement` dans ce
    ticket (pas de lecture candidate, décision de conception, point C).
    """

    class Meta:
        model = DevisAjustement
        fields = ['id', 'devis', 'organization', 'ecart', 'created_by', 'created_at']
        read_only_fields = fields
