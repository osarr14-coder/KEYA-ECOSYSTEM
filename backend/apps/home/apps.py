from django.apps import AppConfig


class HomeConfig(AppConfig):
    """Aucun modèle propre à cette app (ticket 008) : c'est une couche
    d'agrégation en lecture seule au-dessus de `programs`/`trust`/`evidence`/
    `inspections` — label explicite pour éviter toute ambiguïté avec le mot
    générique « home », même schéma que `apps.tasks` (label `inbox_tasks`).
    """

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.home'
    label = 'client_home'
