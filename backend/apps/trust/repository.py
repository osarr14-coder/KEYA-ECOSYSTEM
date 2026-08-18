"""Seul point d'entrée pour créer et lire des `TrustEvent`.

Volontairement : aucune fonction `update` ni `delete` n'existe dans ce
module — ni ne doit jamais y être ajoutée (ticket 003, critère
d'acceptation). Une correction n'est jamais une modification, c'est un
nouvel appel à `create()` avec `previous_event` renseigné.
"""

from django.contrib.contenttypes.models import ContentType

from .models import TrustEvent

# Ordre canonique "plus récent d'abord" d'un queryset TrustEvent, tie-break
# `sequence` inclus (migration 0004) — jamais `-created_at` seul, ambigu
# entre deux événements du même sujet créés dans la même transaction (ex.
# `_advance_existing_reserve`, qui enchaîne `nouvelle_inspection` puis
# `levee`/`rejetee` sans commit intermédiaire). SEUL endroit du projet qui
# définit cet ordre : tout code qui a besoin de trier des TrustEvent doit
# importer et utiliser ce tuple, jamais dupliquer `.order_by('-created_at')`
# localement — un test de garde (`apps/trust/tests.py::
# TestNoDirectTrustEventOrderingOutsideRepository`) scanne le code source du
# reste du projet pour empêcher cette classe de bug de réapparaître
# silencieusement (trouvée et corrigée au ticket 013 bis dans
# `apps.build.services._bulk_open_reserves` et
# `apps.home.services.compute_milestone_status`/`get_latest_notable_event`).
LATEST_FIRST_ORDERING = ('-created_at', '-sequence')


def create(*, subject, organization, level, actor, source, scope='', previous_event=None):
    return TrustEvent.objects.create(
        subject_type=ContentType.objects.get_for_model(subject),
        subject_id=subject.pk,
        organization=organization,
        level=level,
        actor=actor,
        source=source,
        scope=scope,
        previous_event=previous_event,
    )


def list_for_subject(subject):
    """Tous les événements d'un sujet, du plus récent au plus ancien
    (`LATEST_FIRST_ORDERING`, tie-break `sequence` inclus)."""
    content_type = ContentType.objects.get_for_model(subject)
    return TrustEvent.objects.filter(
        subject_type=content_type, subject_id=subject.pk,
    ).order_by(*LATEST_FIRST_ORDERING)


def get_current_status(subject):
    """Le dernier `TrustEvent` de ce sujet, avec sa provenance complète
    (level, source, actor, scope, created_at) — jamais un calcul de score ni
    un pourcentage : le statut EST l'événement, rien n'est dérivé
    numériquement de la séquence d'événements.

    Retourne `None` si aucun événement n'existe encore pour ce sujet.
    """
    return list_for_subject(subject).first()
