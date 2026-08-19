import uuid

from django.conf import settings
from django.db import models

from apps.organizations.models import Organization
from apps.programs.models import Lot


class Devis(models.Model):
    """Une offre chiffrée d'une organisation constructeur CANDIDATE sur un
    `Lot` mis en concurrence — ticket 022. Création exclusive par
    `admin_keyimmo` (voir `apps/procurement/views.py`), même restriction
    que `InspectionMission` (ticket 012) : aucun endpoint d'écriture pour
    le rôle constructeur — décision de conception validée avant
    implémentation (voir `022-verrouillage-devis-mise-en-concurrence.md`).

    Une ligne `Devis` PAR couple (lot, organisation candidate) — plusieurs
    lignes pour un même lot sont attendues, c'est la mise en concurrence
    elle-même (voir le ticket, section « Note de conception — un seul
    modèle Devis, fusion volontaire avec la notion de candidature »).

    `organization` = organisation du LOT (le programme/sponsor), PAS celle
    du candidat — même convention que `Inspection.organization`/
    `InspectionMission.organization` (tickets 005/012).
    `candidate_organization` = l'organisation constructeur qui a soumis ce
    devis — jamais nécessairement membre de `organization` (pas de règle
    d'indépendance ici, contrairement à l'inspecteur, ticket 005 — hors
    scope de ce ticket).

    Aucun champ statut stocké : le statut (`candidat`/`verrouille`) se
    dérive du dernier `TrustEvent` de ce sujet (voir
    `apps/procurement/services.py::get_devis_status`), doctrine Visible
    Trust appliquée sans exception, comme `InspectionMission`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='devis_received',
    )
    candidate_organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='devis_submitted',
    )
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='devis_set')
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    logged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='devis_logged',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'procurement_devis'

    def __str__(self):
        return f'Devis — {self.candidate_organization} → {self.lot}'
