from rest_framework import serializers

from apps.organizations.models import Organization

from . import services
from .models import Devis, DevisAjustement, LotBcCharge, LotLedger


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

    **`lot_detail`/`candidate_organization_detail` (ticket B-029)** — noms
    lisibles, en PLUS des UUID bruts existants (`organization`,
    `candidate_organization`, `lot`), jamais à leur place (décision A) :
    remplacer ces champs casserait `apps/web/src/api/types.ts` et tout code
    frontend qui recopie ces UUID vers une requête suivante
    (`DevisLockView`/`DevisAjustementView` attendent `organization` en UUID
    brut dans leur corps). Réutilise LITTÉRALEMENT les serializers du
    ticket B-028 (décision B) — `LotSearchResultSerializer`/
    `OrganizationSearchResultSerializer`, pas une forme dupliquée. Aucun
    `organization_detail` séparé (décision C) : `Devis.organization` vaut
    TOUJOURS l'organisation du lot par construction (voir le modèle) —
    identique à `lot_detail['organization']`, un champ dédié dupliquerait
    l'information sans rien ajouter.

    **`get_lot_detail`/`get_candidate_organization_detail` passent PAR le
    service** (`apps.procurement.services.get_devis_lot_detail`/
    `get_devis_candidate_organization_detail`), jamais un accès direct
    `obj.lot`/`obj.candidate_organization` dans le serializer — bug réel
    trouvé au premier lancement des tests de ce ticket : `Lot`/`Asset`/
    `Program` sont sous RLS, et le contexte de la connexion est déjà celui
    de l'admin (restauré par `create_devis`/`lock_devis` AVANT la
    sérialisation) — accéder à `obj.lot.asset.program` sans bascule échoue
    en `Asset.DoesNotExist`, même piège déjà documenté pour `get_status`
    (ticket 022).
    """

    status = serializers.SerializerMethodField()
    lot_detail = serializers.SerializerMethodField()
    candidate_organization_detail = serializers.SerializerMethodField()

    class Meta:
        model = Devis
        fields = [
            'id', 'organization', 'candidate_organization', 'lot',
            'amount', 'marge_estimee', 'logged_by', 'created_at', 'status',
            'lot_detail', 'candidate_organization_detail',
        ]
        read_only_fields = fields

    def get_status(self, obj):
        request = self.context['request']
        restore_organization_id = request.organization.id if request.organization else None
        return services.get_devis_status(obj, restore_organization_id=restore_organization_id)

    def get_lot_detail(self, obj):
        request = self.context['request']
        restore_organization_id = request.organization.id if request.organization else None
        return services.get_devis_lot_detail(obj, restore_organization_id=restore_organization_id)

    def get_candidate_organization_detail(self, obj):
        request = self.context['request']
        restore_organization_id = request.organization.id if request.organization else None
        return services.get_devis_candidate_organization_detail(obj, restore_organization_id=restore_organization_id)


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


class LotLedgerCreateSerializer(serializers.Serializer):
    """Entrée de `POST /api/procurement/lot-ledgers/` — ticket B-035.
    `organization` est l'organisation du LOT (cible de la bascule RLS),
    même conséquence assumée que `DevisCreateSerializer`. `prix_client`
    saisi manuellement par `admin_keyimmo` — aucun calcul dérivé (voir
    `apps.procurement.services.create_lot_ledger`).
    """

    organization = serializers.UUIDField()
    lot = serializers.UUIDField()
    prix_client = serializers.DecimalField(max_digits=16, decimal_places=2)


class LotLedgerSerializer(serializers.ModelSerializer):
    """Réponse admin_keyimmo — seule audience de `LotLedger` dans ce
    ticket (aucune lecture candidate/sponsor). `foncier_alloue`/
    `be_alloue` sont le snapshot figé à la création (décision E du ticket)
    — jamais recalculés ici.
    """

    class Meta:
        model = LotLedger
        fields = [
            'id', 'organization', 'lot', 'prix_client',
            'foncier_alloue', 'be_alloue', 'created_by', 'created_at',
        ]
        read_only_fields = fields


class LotBcChargeSerializer(serializers.ModelSerializer):
    """Réponse admin_keyimmo — ticket B-036, décision J. Seule audience de
    `LotBcCharge` (aucune lecture candidate/sponsor, même famille que
    `LotLedgerSerializer`).
    """

    class Meta:
        model = LotBcCharge
        fields = [
            'id', 'organization', 'lot', 'mission', 'jalon_type', 'montant',
            'is_global_reference', 'created_by', 'created_at',
        ]
        read_only_fields = fields


class OrganizationSearchResultSerializer(serializers.ModelSerializer):
    """Réponse de `GET /api/procurement/admin/organizations/?q=` — ticket
    B-028. Aucun champ sensible (`Organization` n'en porte aucun).
    """

    class Meta:
        model = Organization
        fields = ['id', 'name']
        read_only_fields = fields


class LotSearchResultSerializer(serializers.Serializer):
    """Réponse de `GET /api/procurement/admin/lots/?q=` — ticket B-028,
    décision C : `organization`/`program` imbriqués (jamais `asset`, pas
    demandé, pas nécessaire pour soumettre `POST /api/procurement/devis/`).
    Objets simples (pas de `ModelSerializer` imbriqué) : seuls `id`/`name`
    sont exposés pour chacun, aucun besoin d'un serializer dédié réutilisé
    ailleurs.
    """

    id = serializers.UUIDField()
    name = serializers.CharField()
    organization = serializers.SerializerMethodField()
    program = serializers.SerializerMethodField()

    def get_organization(self, lot):
        return {'id': str(lot.organization_id), 'name': lot.organization.name}

    def get_program(self, lot):
        return {'id': str(lot.asset.program_id), 'name': lot.asset.program.name}
