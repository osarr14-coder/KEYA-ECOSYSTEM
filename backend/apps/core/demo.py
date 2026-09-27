"""Audit UI R1 (D01, M01, T13) — instance de démonstration active.

`active_demo_instance()` : l'instance ACTIVE ou `None` (base sans
démonstration, ex. tests unitaires : aucun filtrage). `demo_scope(prefix)` :
filtre Q à appliquer aux listes métier — les objets d'une AUTRE instance, ou
créés hors scénario, ne sont jamais listés quand une instance est active.
"""
from django.db.models import Q

from apps.core.models import DemoInstance, DemoInstanceStatus

ENVIRONMENT = 'DEMO'


def active_demo_instance():
    return DemoInstance.objects.filter(status=DemoInstanceStatus.ACTIVE).first()


def demo_scope(prefix=''):
    """Filtre des programmes (ou objets reliés via `prefix`, ex.
    `'asset__program__'`) sur l'instance active. Aucun filtre sans instance
    active."""
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
        return response
