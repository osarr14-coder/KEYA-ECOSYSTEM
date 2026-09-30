"""Audit UI R1 (D01, M01, T13) — instance de démonstration active.

`active_demo_instance()` : l'instance ACTIVE ou `None` (base sans
démonstration, ex. tests unitaires : aucun filtrage). `demo_scope(prefix)` :
filtre Q à appliquer aux listes métier — les objets d'une AUTRE instance, ou
créés hors scénario, ne sont jamais listés quand une instance est active.
"""
from contextlib import contextmanager
from contextvars import ContextVar

from django.conf import settings
from django.db.models import Q

from apps.core.models import DemoInstance, DemoInstanceStatus

# ADR 0004 : environnement du déploiement (réglage KEYA_ENVIRONMENT, obligatoire).
ENVIRONMENT = settings.KEYA_ENVIRONMENT
# Lot 5 (PO-2026-09-29-01) — instance consultée par la requête en cours,
# posée par `OrganizationScopeMiddleware` quand l'en-tête
# `X-Demo-Instance-View` est accepté (administrateur, gestionnaire). Vide :
# instance active, comme avant.
_viewed_instance = ContextVar('viewed_demo_instance', default=None)


def active_demo_instance():
    return DemoInstance.objects.filter(status=DemoInstanceStatus.ACTIVE).first()


def viewed_demo_instance():
    """Instance lue par la requête : l'archive demandée, sinon l'active."""
    return _viewed_instance.get() or active_demo_instance()


def viewing_archive():
    instance = _viewed_instance.get()
    return instance is not None and instance.status == DemoInstanceStatus.ARCHIVED


@contextmanager
def instance_view(instance):
    token = _viewed_instance.set(instance)
    try:
        yield instance
    finally:
        _viewed_instance.reset(token)


def demo_scope(prefix=''):
    """Filtre des programmes (ou objets reliés via `prefix`, ex.
    `'asset__program__'`) sur l'instance consultée — l'active par défaut,
    une archive quand la requête en demande une (lot 5). Aucun filtre sans
    instance."""
    instance = viewed_demo_instance()
    if instance is None:
        return Q()
    return Q(**{f'{prefix}demo_instance': instance})


def active_scope(prefix=''):
    """Toujours l'instance ACTIVE, quel que soit l'en-tête : écrans des
    rôles qui n'ont pas accès aux archives (A6)."""
    instance = active_demo_instance()
    if instance is None:
        return Q()
    return Q(**{f'{prefix}demo_instance': instance})


def demo_instance_payload(instance):
    if instance is None:
        return None
    return {
        'code': instance.code,
        'dataset_version': instance.dataset_version,
        'status': instance.status,
        'environment': ENVIRONMENT,
        'created_at': instance.created_at.isoformat(),
    }


class DemoMarkingMiddleware:
    """T13 / CDC §3.1 : le marquage s'applique aussi aux API. Chaque réponse
    `/api/` porte l'environnement et l'identifiant d'instance."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith('/api/'):
            response['X-Environment'] = ENVIRONMENT
            instance = active_demo_instance()
            if instance is not None:
                response['X-Demo-Instance'] = instance.code
            # Lot 5 (T13) : l'instance réellement lue, quand c'est une archive.
            viewed = getattr(request, 'viewed_demo_instance', None)
            if viewed is not None:
                response['X-Demo-Instance-View'] = f'{viewed.code}; {viewed.status}'
        return response
