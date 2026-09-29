import uuid

from django.db import models
from django.db.models import Q


class DemoInstanceStatus(models.TextChoices):
    ACTIVE = 'ACTIVE', 'Active'
    ARCHIVED = 'ARCHIVED', 'Archivée'


class DemoInstance(models.Model):
    """Audit UI R1 (D01, M01) — instance de démonstration (CDC R1 §3.1, §5).

    Toute la démonstration se déroule dans UNE instance active : son
    identifiant est affiché sur chaque écran (bandeau) et porté par chaque
    réponse d'API (en-tête `X-Demo-Instance`). Les programmes du scénario y
    sont rattachés ; quand une instance est active, seules ses données sont
    listées (les objets créés hors scénario ne sont plus visibles).

    Table de référence globale, sans RLS (comme `CountryPack`) : l'identifiant
    d'instance n'est pas une donnée métier et doit être lisible sans compte.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=40, unique=True)
    dataset_version = models.CharField(max_length=40)
    status = models.CharField(max_length=10, choices=DemoInstanceStatus.choices, default=DemoInstanceStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    origin = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT, related_name='successors')
    # Lot 5 (PO-2026-09-29-01) — programmes de l'instance, relevés à
    # l'archivage : table sans RLS, lisible pour écarter les tâches d'une
    # archive de la boîte de chacun sans jointure sur des tables en RLS.
    program_ids = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = 'core_demo_instance'
        constraints = [
            # Une seule instance ACTIVE à la fois (CDC §3.1).
            models.UniqueConstraint(
                fields=['status'], condition=Q(status='ACTIVE'), name='core_demo_instance_single_active',
            ),
        ]

    def __str__(self):
        return f'{self.code} ({self.status})'
