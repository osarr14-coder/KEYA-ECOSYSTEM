import uuid

from django.conf import settings
from django.db import models

from apps.organizations.models import Organization
from apps.programs.models import Lot


class LitigeStatus(models.TextChoices):
    OUVERT = 'ouvert', 'Ouvert'
    RESOLU = 'resolu', 'Résolu'
    REJETE = 'rejete', 'Rejeté'


class Litige(models.Model):
    """Circuit formel de résolution de litiges (ticket B-041, Gate 3 item
    4) — ouvert par un client sur un `Lot` qui lui est assigné (`LotClient`,
    ticket 008), résolu par `admin_keyimmo` uniquement.

    `status` est un champ réellement STOCKÉ ici, et c'est volontaire — même
    justification que `Task` (ticket 006) : la doctrine « le statut ne se
    stocke jamais, il se dérive du dernier TrustEvent » (CLAUDE.md) concerne
    les objets Visible Trust (Milestone, WorkDeclaration, Evidence, Reserve
    — dont le statut est une AFFIRMATION DE CONFIANCE avec provenance). Un
    `Litige` n'affirme aucune confiance sur le `Lot` qu'il référence — son
    statut (traité ou non) est un fait sur LUI-MÊME, jamais sur le lot.
    Résoudre un litige ne doit d'ailleurs jamais écrire de `TrustEvent` —
    critère d'acceptation explicite (voir apps/backoffice/tests.py, même
    garde que pour le reste du back-office).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='litiges',
    )
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='litiges')
    opened_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='litiges_ouverts',
    )
    description = models.TextField()

    status = models.CharField(max_length=20, choices=LitigeStatus.choices, default=LitigeStatus.OUVERT)
    resolution_note = models.TextField(blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name='litiges_resolus',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'support_litige'
        ordering = ['-created_at']

    def __str__(self):
        return f'Litige {self.status} — {self.lot} ({self.created_at:%Y-%m-%d})'
