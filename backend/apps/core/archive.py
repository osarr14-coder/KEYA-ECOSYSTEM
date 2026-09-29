"""Lot 5 (PO-2026-09-29-02, CDC §10) — une instance archivée « interdit ses
nouvelles écritures ».

Garde au niveau des MODÈLES, indépendante des routes : tout enregistrement
(création, modification, suppression par l'ORM) d'un objet métier rattaché
à un programme d'une instance archivée lève `ArchivedInstanceError` (409),
quelle que soit la vue, la commande ou la tâche qui l'a tenté. Complète le
refus posé par `OrganizationScopeMiddleware` sur les requêtes qui consultent
une archive. Une écriture de masse (`QuerySet.update()`) n'émet pas de
signal : le code métier n'en fait pas sur des objets d'une autre instance
que celle qu'il vient de lire.
"""
from django.apps import apps
from django.db.models.signals import pre_delete, pre_save
from rest_framework.exceptions import APIException

from apps.core.models import DemoInstance, DemoInstanceStatus

ARCHIVE_READ_ONLY = 'Instance archivée — lecture seule : aucune modification possible.'


class ArchivedInstanceError(APIException):
    status_code = 409
    default_detail = ARCHIVE_READ_ONLY
    default_code = 'instance_archived'


# Modèle → (chemin depuis `DemoInstance`, attribut de l'objet qui porte la clé).
GUARDED = {
    'programs.Program': ('programs__id', 'id'),
    'programs.Asset': ('programs__id', 'program_id'),
    'programs.Lot': ('programs__assets__id', 'asset_id'),
    'programs.Milestone': ('programs__assets__lots__id', 'lot_id'),
    'programs.LotClient': ('programs__assets__lots__id', 'lot_id'),
    'sales.Reservation': ('programs__assets__lots__id', 'lot_id'),
    'sales.ContractVersion': ('programs__assets__lots__reservations__id', 'reservation_id'),
    'sales.PaymentCall': ('programs__assets__lots__reservations__id', 'reservation_id'),
    'sales.CustomerReceipt': ('programs__assets__lots__reservations__id', 'reservation_id'),
    'sales.Allocation': ('programs__assets__lots__reservations__receipts__id', 'receipt_id'),
    'sales.PaymentNotice': ('programs__assets__lots__reservations__id', 'reservation_id'),
    'sales.Disbursement': ('programs__id', 'program_id'),
    'evidence.WorkDeclaration': ('programs__assets__lots__milestones__id', 'milestone_id'),
    'evidence.Evidence': ('programs__assets__lots__milestones__work_declarations__id', 'work_declaration_id'),
    'inspections.Inspection': ('programs__assets__lots__id', 'lot_id'),
    'inspections.Reserve': ('programs__assets__lots__id', 'lot_id'),
    'inspections.ReserveCorrection': ('programs__assets__lots__reserves__id', 'reserve_id'),
    'inspections.InspectionMission': (
        'programs__assets__lots__milestones__work_declarations__id', 'work_declaration_id',
    ),
    'tasks.Task': ('programs__id', 'program_id'),
    'support.Litige': ('programs__assets__lots__id', 'lot_id'),
}


def _archived(path, value):
    if value is None:
        return False
    return DemoInstance.objects.filter(status=DemoInstanceStatus.ARCHIVED, **{path: value}).exists()


def is_archived(obj):
    """Vrai si `obj` (modèle gardé) appartient à une instance archivée."""
    rule = GUARDED.get(obj._meta.label)
    if rule is None:
        return False
    if obj._meta.label == 'programs.Program':
        instance_id = getattr(obj, 'demo_instance_id', None)
        return bool(instance_id) and DemoInstance.objects.filter(
            id=instance_id, status=DemoInstanceStatus.ARCHIVED,
        ).exists()
    path, attribute = rule
    return _archived(path, getattr(obj, attribute, None))


def program_is_archived(program_id):
    return _archived('programs__id', program_id)


def _guard(sender, instance, **kwargs):
    if kwargs.get('raw'):
        return
    if is_archived(instance):
        raise ArchivedInstanceError()


def connect():
    for label in GUARDED:
        try:
            model = apps.get_model(label)
        except LookupError:
            continue
        pre_save.connect(_guard, sender=model, dispatch_uid=f'archive-guard-save-{label}')
        pre_delete.connect(_guard, sender=model, dispatch_uid=f'archive-guard-delete-{label}')
