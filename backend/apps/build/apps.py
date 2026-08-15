from django.apps import AppConfig


class BuildConfig(AppConfig):
    """Aucun modèle propre à cette app (ticket 009) : comme `apps.home`
    (ticket 008), c'est une couche d'agrégation en lecture (+ quelques
    actions qui délèguent à des services existants d'autres apps) au-dessus
    de `programs`/`trust`/`evidence`/`inspections` — label explicite pour
    éviter toute ambiguïté avec le mot générique « build » (ex : outillage
    front), même schéma que `apps.tasks` (`inbox_tasks`) et `apps.home`
    (`client_home`).
    """

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.build'
    label = 'build_control_tower'
