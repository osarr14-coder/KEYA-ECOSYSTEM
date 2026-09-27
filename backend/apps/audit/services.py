from .models import AuditEvent


def record(*, organization_id, actor, action, obj, payload=None, justification=''):
    """Ajoute un événement au journal. Doit être appelé sous le contexte RLS
    de `organization_id` (policy d'insertion), dans la même transaction que
    l'effet métier qu'il trace : l'un ne peut exister sans l'autre (CDC §10).
    """
    return AuditEvent.objects.create(
        organization_id=organization_id,
        actor=actor,
        action=action,
        object_type=obj._meta.label_lower,
        object_id=obj.pk,
        payload=payload or {},
        justification=justification,
    )
