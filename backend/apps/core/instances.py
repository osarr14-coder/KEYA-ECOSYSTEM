"""Lot 5 — archivage d'instance depuis l'Administration (CDC §9.2 étape 11,
T14, PO-2026-09-29-03) et rétention (A6, PO-2026-09-29-04).

L'instance active est archivée (elle reste en base, intacte, en lecture
seule) et une instance NOUVELLE reçoit le jeu initial versionné : aucun
objet n'est lié à l'ancienne. Les comptes de démonstration, communs aux
instances, ne sont pas touchés. L'opération est inscrite au journal.
"""
from datetime import timedelta

from decouple import config
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.audit import services as audit
from apps.core.models import DemoInstance, DemoInstanceStatus
from apps.core.rls import set_rls_context
from apps.organizations.models import Organization

RETENTION_DAYS = 90


def campaign_end():
    """A6 : fin de la campagne investisseurs (`DEMO_CAMPAIGN_END`,
    AAAA-MM-JJ). `None` tant qu'elle n'est pas fixée."""
    from datetime import date

    value = config('DEMO_CAMPAIGN_END', default='').strip()
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def retention_until():
    end = campaign_end()
    return end + timedelta(days=RETENTION_DAYS) if end else None


def _instance_program_ids(instance):
    ids = []
    for organization_id in Organization.objects.values_list('id', flat=True):
        set_rls_context(organization_id=organization_id)
        from apps.programs.models import Program

        ids.extend(str(pk) for pk in Program.objects.filter(
            demo_instance=instance, organization_id=organization_id,
        ).values_list('id', flat=True))
    return ids


def archive_active_instance(*, actor, caller_organization_id, confirm_code=None, renew=True):
    """Archive l'instance active et, avec `renew`, crée la suivante depuis le
    jeu versionné. `confirm_code` doit reprendre le code de l'instance active
    (confirmation saisie) ; `None` depuis la commande d'exploitation."""
    from apps.sales.management.commands.seed_demo_scenario import (
        DATASET_VERSION, PROMOTER_ORG, Command as SeedCommand, create_instance_dataset, new_instance_code,
    )

    try:
        with transaction.atomic():
            current = DemoInstance.objects.select_for_update().filter(status=DemoInstanceStatus.ACTIVE).first()
            if current is None:
                raise ValidationError({'detail': 'Aucune instance de démonstration active.'})
            if confirm_code is not None and confirm_code.strip() != current.code:
                raise ValidationError({'confirm_code': 'Le code saisi ne correspond pas à l’instance active.'})
            current.program_ids = _instance_program_ids(current)
            current.status = DemoInstanceStatus.ARCHIVED
            current.archived_at = timezone.now()
            current.save(update_fields=['status', 'archived_at', 'program_ids'])
            successor = None
            if renew:
                promoter = Organization.objects.filter(name=PROMOTER_ORG).first()
                if promoter is None:
                    raise ValidationError({'detail': 'Jeu de démonstration absent : organisation du programme introuvable.'})
                SeedCommand._ensure_country_pack()
                successor = DemoInstance.objects.create(
                    code=new_instance_code(), dataset_version=DATASET_VERSION, origin=current,
                )
                create_instance_dataset(successor, promoter)
            if caller_organization_id is not None:
                set_rls_context(organization_id=caller_organization_id)
                audit.record(
                    organization_id=caller_organization_id, actor=actor, action='instance.archived', obj=current,
                    payload={'code': current.code, 'dataset_version': current.dataset_version,
                             'programs': len(current.program_ids)},
                )
                if successor is not None:
                    audit.record(
                        organization_id=caller_organization_id, actor=actor, action='instance.created', obj=successor,
                        payload={'code': successor.code, 'dataset_version': successor.dataset_version,
                                 'origin': current.code},
                    )
    finally:
        if caller_organization_id is not None:
            set_rls_context(organization_id=caller_organization_id)
    return current, successor


def instance_rows():
    until = retention_until()
    today = timezone.now().date()
    rows = []
    for instance in DemoInstance.objects.select_related('origin').order_by('-created_at'):
        archived = instance.status == DemoInstanceStatus.ARCHIVED
        rows.append({
            'code': instance.code,
            'status': instance.status,
            'status_label': instance.get_status_display(),
            'dataset_version': instance.dataset_version,
            'created_at': instance.created_at.isoformat(),
            'archived_at': instance.archived_at.isoformat() if instance.archived_at else None,
            'origin': instance.origin.code if instance.origin_id else None,
            # A6 : conservation jusqu'à fin de campagne + 90 jours.
            'retention_until': until.isoformat() if archived and until else None,
            'retention_expired': bool(archived and until and today > until),
        })
    return rows


def check_retention(*, actor=None, organization_id=None):
    """Archives dont la conservation est échue. Inscrit le contrôle au
    journal quand une organisation est fournie. La suppression effective
    reste une opération d'exploitation privilégiée (PO-2026-09-29-04)."""
    expired = [row for row in instance_rows() if row['retention_expired']]
    if organization_id is not None:
        for row in expired:
            instance = DemoInstance.objects.get(code=row['code'])
            set_rls_context(organization_id=organization_id)
            audit.record(
                organization_id=organization_id, actor=actor, action='instance.retention_expired', obj=instance,
                payload={'code': row['code'], 'retention_until': row['retention_until']},
            )
    return expired
