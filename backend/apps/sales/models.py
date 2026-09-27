import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.organizations.models import Organization
from apps.programs.models import Lot


class ReservationStatus(models.TextChoices):
    """CDC V3 §6.1 — `REQUESTED → HELD → RESERVED → COMMITTED`, sorties
    `EXPIRED`/`CANCELLED`. Vocabulaire fixe du cycle de vente (comme
    `TrustLevel`), pas une donnée qui varie par CountryPack.

    `RESERVED`/`COMMITTED` sont atteints en Phase 3 (encaissements simulés,
    voir B-048, « Ajustement de séquencement ») mais déclarés dès maintenant :
    ils comptent comme bloquants dans la contrainte d'unicité ci-dessous, qui
    n'aura donc jamais à être migrée.
    """

    REQUESTED = 'requested', 'Demandée'
    HELD = 'held', 'Bloquée'
    RESERVED = 'reserved', 'Réservée'
    COMMITTED = 'committed', 'Concrétisée'
    EXPIRED = 'expired', 'Expirée'
    CANCELLED = 'cancelled', 'Annulée'


BLOCKING_STATUSES = (ReservationStatus.HELD, ReservationStatus.RESERVED, ReservationStatus.COMMITTED)

# CDC V3 A10 (proposition) : XOF seul actif, code devise conservé sur chaque
# montant. Aucun `CountryPack` ne porte encore de devise.
DEFAULT_CURRENCY = 'XOF'


class Reservation(models.Model):
    """Réservation d'un `Lot` par un client (ticket B-048, CDC V3 §5/§6.1).

    `organization` = celle du LOT (dénormalisée, même pattern RLS que
    `apps.programs`), jamais celle du client : le client n'est pas membre de
    l'organisation du programme. Il lit ses propres réservations via la
    branche `client_id = utilisateur courant` de la policy RLS (précédent :
    `InspectionMission`, ticket 011).

    Le statut est STOCKÉ, contrairement au statut d'un jalon (doctrine
    Visible Trust) : c'est lui que l'index unique partiel protège, garantie
    d'unicité que seule une valeur en base peut porter. L'historique complet
    des transitions est dans `apps.audit.AuditEvent`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='reservations',
    )
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='reservations')
    client = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='reservations',
    )
    status = models.CharField(max_length=20, choices=ReservationStatus.choices)
    held_until = models.DateTimeField()
    # Figés au blocage : un changement ultérieur de `Lot.sale_price` ne
    # modifie jamais une réservation en cours.
    price_amount = models.DecimalField(max_digits=16, decimal_places=2)
    currency = models.CharField(max_length=3, default=DEFAULT_CURRENCY)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name='cancelled_reservations',
    )
    cancellation_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sales_reservation'
        constraints = [
            # CDC §5 : « une seule réservation active bloquante par bien ».
            # Filet en base derrière le verrou de ligne du service (T01).
            models.UniqueConstraint(
                fields=['lot'],
                condition=Q(status__in=[status.value for status in BLOCKING_STATUSES]),
                name='sales_one_blocking_reservation_per_lot',
            ),
        ]

    def __str__(self):
        return f'Réservation {self.lot} — {self.client} ({self.status})'


class ContractStatus(models.TextChoices):
    """CDC V3 §6.2 — `DRAFT → REVIEW → APPROVED → SIGNED_SIMULATED`
    (ticket B-049). Retour `REVIEW → DRAFT` autorisé (correction avant
    approbation)."""

    DRAFT = 'draft', 'Brouillon'
    REVIEW = 'review', 'En revue'
    APPROVED = 'approved', 'Approuvé'
    SIGNED_SIMULATED = 'signed_simulated', 'Signé (simulation)'


IN_PROGRESS_CONTRACT_STATUSES = (ContractStatus.DRAFT, ContractStatus.REVIEW)


class ContractVersion(models.Model):
    """Une version du contrat fictif d'une réservation (ticket B-049, CDC
    V3 §5/§6.2). Jamais écrasée : une correction crée la version suivante.

    `organization` et `client` sont dénormalisés depuis la réservation :
    même policy RLS que `Reservation` (organisation du lot OU client
    lui-même). Le contenu est figé dès la soumission et toute version signée
    est immuable — garanti par un trigger en base (migration 0004), pas
    seulement par le code applicatif (T04).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='contract_versions',
    )
    reservation = models.ForeignKey(Reservation, on_delete=models.PROTECT, related_name='contract_versions')
    client = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='contract_versions',
    )
    version = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=ContractStatus.choices, default=ContractStatus.DRAFT)
    content = models.TextField()
    authored_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='authored_contract_versions',
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name='approved_contract_versions',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sales_contract_version'
        constraints = [
            models.UniqueConstraint(fields=['reservation', 'version'], name='sales_contract_unique_version'),
            # Au plus une version en cours de rédaction/revue par réservation.
            models.UniqueConstraint(
                fields=['reservation'],
                condition=Q(status__in=[status.value for status in IN_PROGRESS_CONTRACT_STATUSES]),
                name='sales_contract_one_version_in_progress',
            ),
        ]

    def __str__(self):
        return f'Contrat v{self.version} — {self.reservation} ({self.status})'
