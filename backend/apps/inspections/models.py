import uuid

from django.conf import settings
from django.db import models

from apps.evidence.models import Evidence, WorkDeclaration
from apps.organizations.models import Organization
from apps.programs.models import Lot


class InspectionOutcome(models.TextChoices):
    CONFORME = 'conforme', 'Conforme'
    AVEC_RESERVE = 'avec_reserve', 'Avec réserve'


class Inspection(models.Model):
    """Réalisée par un inspecteur, rattachée à une `Evidence` OU un
    `WorkDeclaration` (jamais les deux — voir la contrainte `Meta`).

    `organization` est l'organisation du LOT inspecté (celle du
    constructeur), PAS celle de l'inspecteur — l'inspecteur, par
    construction (règle d'indépendance du contrôle), n'en est jamais membre.
    Écrire cette ligne exige donc de basculer explicitement le contexte RLS
    vers l'organisation cible — voir `apps/inspections/services.py`, qui
    reprend le même schéma que le bootstrap de
    `apps.accounts.serializers.RegisterSerializer` (ticket 001) : une
    exception étroite et documentée, jamais un contournement général.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='inspections',
    )
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='inspections')
    inspector = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='inspections',
    )

    work_declaration = models.ForeignKey(
        WorkDeclaration, on_delete=models.PROTECT, related_name='inspections',
        null=True, blank=True,
    )
    evidence = models.ForeignKey(
        Evidence, on_delete=models.PROTECT, related_name='inspections',
        null=True, blank=True,
    )

    outcome = models.CharField(max_length=20, choices=InspectionOutcome.choices)

    # Renseigné uniquement pour une inspection de suivi qui réexamine une
    # réserve déjà ouverte — c'est cette inspection-là (jamais le
    # constructeur) qui peut faire passer la réserve à `levee`/`rejetee`.
    reserve = models.ForeignKey(
        'Reserve', on_delete=models.PROTECT, related_name='follow_up_inspections',
        null=True, blank=True,
    )

    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inspections_inspection'
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(work_declaration__isnull=False, evidence__isnull=True)
                    | models.Q(work_declaration__isnull=True, evidence__isnull=False)
                ),
                name='inspection_exactly_one_subject',
            ),
        ]

    def __str__(self):
        return f'Inspection {self.outcome} — {self.lot} ({self.created_at:%Y-%m-%d})'


class Reserve(models.Model):
    """Machine à état explicite — le statut courant n'est PAS un champ sur
    ce modèle, il se dérive du dernier `TrustEvent` de ce sujet (voir
    `apps/inspections/services.py::get_reserve_status`), doctrine Visible
    Trust (CLAUDE.md). `organization` = organisation du lot (constructeur),
    comme `Inspection`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='reserves',
    )
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='reserves')
    # OneToOne : une inspection ouvre au plus une réserve. Permet
    # `inspection.opened_reserve` en accès direct (objet, pas manager) —
    # exposé par InspectionSerializer pour que le client sache quelle
    # réserve vient d'être créée par sa requête.
    opened_by_inspection = models.OneToOneField(
        Inspection, on_delete=models.PROTECT, related_name='opened_reserve',
    )
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inspections_reserve'

    def __str__(self):
        return f'Réserve — {self.lot} ({self.created_at:%Y-%m-%d})'


class ReserveCorrection(models.Model):
    """Action explicitement permise au constructeur : documenter une
    correction en l'attachant à la réserve concernée. Ne modifie jamais
    directement un statut — la création génère un `TrustEvent` (source
    `correction_proposee`) qui fait progresser la chaîne de la réserve,
    exactement comme toute autre action métier de ce projet (voir
    `apps/programs/services.py` pour le même schéma).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='reserve_corrections',
    )
    reserve = models.ForeignKey(Reserve, on_delete=models.PROTECT, related_name='corrections')
    evidence = models.ForeignKey(Evidence, on_delete=models.PROTECT, related_name='reserve_corrections')
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='reserve_corrections',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inspections_reserve_correction'

    def __str__(self):
        return f'Correction — {self.reserve} ({self.created_at:%Y-%m-%d})'
