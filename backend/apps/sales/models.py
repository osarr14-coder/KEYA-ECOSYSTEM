import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.organizations.models import Organization
from apps.programs.models import Lot, Milestone, Program


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


class PaymentCallKind(models.TextChoices):
    """Ticket B-050 — nature d'un appel de fonds (CDC V3 §5 : « nature
    frais/premier versement/versement suivant »)."""

    FRAIS = 'frais', 'Frais de réservation'
    PREMIER_VERSEMENT = 'premier_versement', 'Complément du premier versement'
    VERSEMENT = 'versement', 'Versement de palier'


class PaymentCall(models.Model):
    """Appel de fonds émis au client d'une réservation (ticket B-050, CDC
    V3 §5/§8.1). Montant CALCULÉ par le serveur (prix figé de la
    réservation, barème légal), jamais saisi.

    Append-only (migration 0006, trigger) : un appel émis n'est jamais
    modifié ni supprimé — CDC §1, « les événements critiques sont ajoutés,
    jamais réécrits ». Son état « soldé » est DÉRIVÉ des affectations
    d'encaissements (B-051), jamais stocké ici.

    Le barème utilisé (`legal_template`) et le plafond du palier sont figés
    sur l'appel : CDC §1, « la version [des paramètres pays] est rattachée
    aux opérations concernées ».
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='payment_calls',
    )
    reservation = models.ForeignKey(Reservation, on_delete=models.PROTECT, related_name='payment_calls')
    client = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='payment_calls',
    )
    kind = models.CharField(max_length=20, choices=PaymentCallKind.choices)
    legal_template = models.ForeignKey(
        'pricing.LegalPaymentTierTemplate', on_delete=models.PROTECT, null=True, blank=True,
        related_name='payment_calls',
    )
    tier_code = models.CharField(max_length=50, blank=True)
    tier_label = models.CharField(max_length=100, blank=True)
    cumulative_cap_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    currency = models.CharField(max_length=3, default=DEFAULT_CURRENCY)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='issued_payment_calls',
    )
    issued_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sales_payment_call'
        constraints = [
            # Frais et premier versement : une fois par réservation.
            models.UniqueConstraint(
                fields=['reservation', 'kind'],
                condition=Q(kind__in=['frais', 'premier_versement']),
                name='sales_payment_call_once_per_kind',
            ),
            # Chaque palier VEFA : une fois par réservation.
            models.UniqueConstraint(
                fields=['reservation', 'tier_code'],
                condition=Q(kind='versement'),
                name='sales_payment_call_once_per_tier',
            ),
            models.CheckConstraint(check=Q(amount__gt=0), name='sales_payment_call_amount_positive'),
        ]

    def __str__(self):
        return f'Appel {self.get_kind_display()} {self.amount} {self.currency} — {self.reservation}'


class FlowStatus(models.TextChoices):
    """CDC V3 §8.3 — `PLANNED → BANK_EXECUTED_SIM → RECONCILED_SIM` pour les
    deux flux (ticket B-051). Pour un encaissement, l'état « prévu » est
    l'appel de fonds lui-même : un encaissement naît donc exécuté."""

    BANK_EXECUTED_SIM = 'bank_executed_sim', 'Reçu en banque (simulé)'
    RECONCILED_SIM = 'reconciled_sim', 'Rapproché (simulé)'


class CustomerReceipt(models.Model):
    """Encaissement SIMULÉ du client vers le compte du programme (ticket
    B-051, CDC V3 §5/§8.1). Enregistré par Finance, jamais par le client ni
    par l'ADV.

    `bank_reference` : référence bancaire simulée, UNIQUE par compte (ici
    l'organisation du programme) et par sens du flux (CDC §8.3) — une
    requête répétée ne crée jamais un second mouvement (T10). Montant,
    devise, réservation et référence sont immuables dès l'enregistrement
    (trigger, migration 0008) ; seul le statut avance.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='customer_receipts',
    )
    reservation = models.ForeignKey(Reservation, on_delete=models.PROTECT, related_name='receipts')
    client = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='customer_receipts',
    )
    bank_reference = models.CharField(max_length=64)
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    currency = models.CharField(max_length=3, default=DEFAULT_CURRENCY)
    received_on = models.DateField()
    status = models.CharField(max_length=20, choices=FlowStatus.choices, default=FlowStatus.BANK_EXECUTED_SIM)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='recorded_customer_receipts',
    )
    recorded_at = models.DateTimeField(auto_now_add=True)
    reconciled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name='reconciled_customer_receipts',
    )
    reconciled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'sales_customer_receipt'
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'bank_reference'], name='sales_receipt_unique_bank_reference',
            ),
            models.CheckConstraint(check=Q(amount__gt=0), name='sales_receipt_amount_positive'),
        ]

    def __str__(self):
        return f'Encaissement {self.bank_reference} {self.amount} {self.currency}'


class Allocation(models.Model):
    """Affectation d'une partie d'un encaissement à un appel de fonds du
    MÊME dossier (ticket B-051, CDC V3 §8.1). Append-only : une affectation
    ne se modifie ni ne se supprime (contrepassation hors MVP). Aucune
    double imputation : la somme des affectations d'un encaissement ne
    dépasse jamais son montant, celle d'un appel jamais le montant appelé
    (vérifié sous verrou de ligne, apps/sales/services.py)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='allocations',
    )
    receipt = models.ForeignKey(CustomerReceipt, on_delete=models.PROTECT, related_name='allocations')
    payment_call = models.ForeignKey(PaymentCall, on_delete=models.PROTECT, related_name='allocations')
    client = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='allocations',
    )
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    allocated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='recorded_allocations',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sales_allocation'
        constraints = [
            models.CheckConstraint(check=Q(amount__gt=0), name='sales_allocation_amount_positive'),
        ]

    def __str__(self):
        return f'Affectation {self.amount} → {self.payment_call_id}'


# ─── Décaissements — ticket B-052 (CDC V3 §8.2/§8.3) ─────────────────────────


class DisbursementStatus(models.TextChoices):
    """Statut de la DEMANDE (CDC §8.2) : `DRAFT → ELIGIBLE → EXECUTED_SIM`,
    `CANCELLED` avant exécution ; `ELIGIBLE → DRAFT` si l'acceptation
    technique devient caduque. `EXECUTED_SIM` et `CANCELLED` sont terminaux
    (trigger, migration 0010)."""

    DRAFT = 'draft', 'Brouillon'
    ELIGIBLE = 'eligible', 'Éligible (montant réservé)'
    EXECUTED_SIM = 'executed_sim', 'Exécuté (simulé)'
    CANCELLED = 'cancelled', 'Annulé'


OPEN_DISBURSEMENT_STATUSES = (DisbursementStatus.DRAFT, DisbursementStatus.ELIGIBLE)


class DisbursementFlowStatus(models.TextChoices):
    """Statut de PREUVE du mouvement (CDC §8.3), distinct du statut de la
    demande : `PLANNED → BANK_EXECUTED_SIM → RECONCILED_SIM`, avec
    `BENEFICIARY_CONFIRMED_SIM` possible entre les deux. La confirmation du
    prestataire n'est pas une preuve bancaire."""

    PLANNED = 'planned', 'Prévu'
    BANK_EXECUTED_SIM = 'bank_executed_sim', 'Exécuté en banque (simulé)'
    BENEFICIARY_CONFIRMED_SIM = 'beneficiary_confirmed_sim', 'Confirmé par le bénéficiaire (simulé)'
    RECONCILED_SIM = 'reconciled_sim', 'Rapproché (simulé)'


NO_CONFIRMATION_REASON = 'Confirmation bénéficiaire non reçue'


class Disbursement(models.Model):
    """Sortie SIMULÉE du compte du programme vers le prestataire affecté au
    lot (ticket B-052, CDC V3 §5/§8.2). Le « compte » est le programme :
    `organization` est celle du programme (scope RLS), `beneficiary_organization`
    l'organisation constructrice, qui voit ses propres sorties.

    Montant, devise, bénéficiaire, jalon et programme sont immuables dès la
    préparation ; référence et date d'exécution une fois posées (trigger,
    migration 0010). Aucune suppression."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='disbursements',
    )
    program = models.ForeignKey(Program, on_delete=models.PROTECT, related_name='disbursements')
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='disbursements')
    milestone = models.ForeignKey(Milestone, on_delete=models.PROTECT, related_name='disbursements')
    beneficiary_organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='received_disbursements',
    )
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    currency = models.CharField(max_length=3, default=DEFAULT_CURRENCY)
    status = models.CharField(max_length=20, choices=DisbursementStatus.choices, default=DisbursementStatus.DRAFT)
    flow_status = models.CharField(
        max_length=30, choices=DisbursementFlowStatus.choices, default=DisbursementFlowStatus.PLANNED,
    )
    prepared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='prepared_disbursements',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    eligible_at = models.DateTimeField(null=True, blank=True)
    # Référence bancaire simulée : unique par compte (programme) dans le sens
    # « sortie » — table distincte des encaissements (CDC §8.3).
    bank_reference = models.CharField(max_length=64, null=True, blank=True)
    executed_on = models.DateField(null=True, blank=True)
    executed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name='executed_disbursements',
    )
    executed_at = models.DateTimeField(null=True, blank=True)
    beneficiary_confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name='confirmed_disbursements',
    )
    beneficiary_confirmed_at = models.DateTimeField(null=True, blank=True)
    reconciled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name='reconciled_disbursements',
    )
    reconciled_at = models.DateTimeField(null=True, blank=True)
    reconciliation_reason = models.CharField(max_length=255, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name='cancelled_disbursements',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = 'sales_disbursement'
        constraints = [
            models.UniqueConstraint(
                fields=['program', 'bank_reference'], name='sales_disbursement_unique_bank_reference',
            ),
            # Idempotence de la préparation : une seule demande ouverte par jalon.
            models.UniqueConstraint(
                fields=['milestone'], condition=Q(status__in=['draft', 'eligible']),
                name='sales_disbursement_one_open_per_milestone',
            ),
            models.CheckConstraint(check=Q(amount__gt=0), name='sales_disbursement_amount_positive'),
            models.CheckConstraint(
                check=~Q(status='executed_sim') | (Q(bank_reference__isnull=False) & Q(executed_on__isnull=False)),
                name='sales_disbursement_executed_has_bank_proof',
            ),
            models.CheckConstraint(
                check=Q(status='executed_sim') | Q(flow_status='planned'),
                name='sales_disbursement_flow_follows_execution',
            ),
        ]

    def __str__(self):
        return f'Décaissement {self.amount} {self.currency} — {self.milestone_id}'
