from django.core.exceptions import ValidationError
from django.utils import timezone

from .models import Litige, LitigeStatus

TERMINAL_STATUSES = {LitigeStatus.RESOLU, LitigeStatus.REJETE}


def open_litige(*, organization, lot, opened_by, description):
    description = description.strip()
    if not description:
        raise ValidationError("La description du litige ne peut pas être vide.")

    return Litige.objects.create(
        organization=organization, lot=lot, opened_by=opened_by, description=description,
    )


def get_litiges_for_lot(lot):
    return Litige.objects.filter(lot=lot).select_related('opened_by', 'resolved_by')


def resolve_litige(*, litige, resolved_by, status, resolution_note):
    """`status` cible doit être un des deux statuts terminaux — jamais un
    retour à `ouvert` (pas de réouverture dans cette passe, voir B-041 hors
    scope). Ne touche JAMAIS `apps.trust` — un litige n'est pas un objet
    Visible Trust (voir `Litige`, docstring).
    """
    if status not in TERMINAL_STATUSES:
        raise ValidationError("Le statut de résolution doit être 'resolu' ou 'rejete'.")
    if litige.status in TERMINAL_STATUSES:
        raise ValidationError("Ce litige est déjà clôturé.")
    resolution_note = resolution_note.strip()
    if not resolution_note:
        raise ValidationError("Une note de résolution est obligatoire.")

    litige.status = status
    litige.resolution_note = resolution_note
    litige.resolved_by = resolved_by
    litige.resolved_at = timezone.now()
    litige.save(update_fields=['status', 'resolution_note', 'resolved_by', 'resolved_at'])
    return litige
