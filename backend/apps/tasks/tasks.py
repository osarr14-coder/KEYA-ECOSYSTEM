from celery import shared_task
from django.db import transaction

from apps.core.rls import set_rls_context


@shared_task(bind=True)
def process_reserve_opened(self, reserve_id, organization_id, actor_user_id=None):
    """Déclenchée par `apps.inspections.services._open_new_reserve` via
    `.delay()` — une vraie tâche Celery asynchrone, pas un signal
    synchrone déguisé en asynchrone (ticket 006, instruction explicite).

    Même schéma de propagation RLS que
    `apps.evidence.tasks.process_document_media` (ticket 004,
    docs/adr/0001-celery-eager-mode.md) : un worker n'a par construction
    aucune requête HTTP pour poser le contexte RLS (organisation active) —
    `organization_id`/`actor_user_id` sont donc des arguments explicites de
    la tâche, posés en tout début d'exécution, à l'intérieur d'un
    `transaction.atomic()` englobant tout son corps (`SET LOCAL` n'a
    d'effet que pour la transaction en cours ; un worker tourne en
    autocommit par défaut).
    """
    with transaction.atomic():
        set_rls_context(organization_id=organization_id, user_id=actor_user_id)

        from apps.inspections.models import Reserve  # import différé : évite un cycle au chargement des tasks Celery

        from . import services

        reserve = Reserve.objects.get(id=reserve_id)
        services.create_task_for_reserve_opened(reserve)
