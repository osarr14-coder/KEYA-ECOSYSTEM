"""Audit UI R1 (R04, PO-2026-09-27-03) — modules hors périmètre du MVP
(CDC §3 « Différé » : marketplace avancée) : Devis / Appels d'offres,
Demandes de programme, Tarifs. Masqués par un réglage, jamais supprimés :
quand `KEYA_DEFERRED_MODULES_ENABLED` est faux, leurs routes répondent 404,
comme si elles n'existaient pas, quel que soit le rôle."""
from django.conf import settings
from rest_framework.exceptions import NotFound
from rest_framework.permissions import BasePermission


def deferred_modules_enabled():
    return getattr(settings, 'KEYA_DEFERRED_MODULES_ENABLED', False)


class DeferredModuleEnabled(BasePermission):
    def has_permission(self, request, view):
        if not deferred_modules_enabled():
            raise NotFound('Module non disponible dans cette démonstration.')
        return True


def offline_sync_enabled():
    return getattr(settings, 'KEYA_OFFLINE_SYNC_ENABLED', False)


class OfflineSyncEnabled(BasePermission):
    """PO-2026-09-28-30 (K04) : synchronisation hors ligne coupée dans le MVP."""

    def has_permission(self, request, view):
        if not offline_sync_enabled():
            raise NotFound('Synchronisation hors ligne non disponible dans cette démonstration.')
        return True
