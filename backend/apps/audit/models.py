from django.conf import settings
from django.db import models

from apps.organizations.models import Organization


class AuditEvent(models.Model):
    """Journal append-only des actions critiques hors chaîne Visible Trust
    (CDC V3 §5 `AuditEvent`, ticket B-048) — réservations dès ce ticket,
    contrats et flux financiers ensuite. `TrustEvent` reste le journal de la
    chaîne de preuve de construction ; les deux ne se remplacent pas.

    Mêmes garanties que `TrustEvent` (ticket 003) : aucune policy RLS
    UPDATE/DELETE et des triggers qui refusent toute modification, y compris
    pour le propriétaire de la table (migration 0002). `id` auto-incrémenté :
    l'ordre d'insertion est l'ordre chronologique, même au sein d'une seule
    transaction (deux événements d'une même action).

    Aucune donnée secrète ne doit y figurer (CDC §5) : `payload` ne porte que
    des identifiants, états et montants métier.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='audit_events',
    )
    # Nul pour une action du système lui-même (ex. expiration d'un blocage).
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name='audit_events',
    )
    action = models.CharField(max_length=100)
    object_type = models.CharField(max_length=100)
    object_id = models.UUIDField()
    payload = models.JSONField(default=dict, blank=True)
    justification = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'audit_event'
        indexes = [models.Index(fields=['object_type', 'object_id'], name='audit_event_object_idx')]

    def __str__(self):
        return f'{self.action} {self.object_type}:{self.object_id}'
