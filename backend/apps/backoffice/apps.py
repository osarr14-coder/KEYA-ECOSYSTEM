from django.apps import AppConfig


class BackofficeConfig(AppConfig):
    """Ticket 011 — back-office minimal réservé à `admin_keyimmo` :
    recherche d'un utilisateur, consultation de son organisation/rôle,
    désactivation de compte. Aucun modèle propre (endpoints sur `User`/
    `Membership`, déjà existants) — même schéma que `apps.home`/`apps.build`
    (ticket 008/009).

    Cette app ne doit JAMAIS importer `apps.trust` — critère d'acceptation
    du ticket : « le back-office ne doit exposer aucune action qui
    court-circuiterait un TrustEvent ». Vérifié par un test de garde qui
    scanne le code source de ce module (`apps/backoffice/tests.py`), pas
    seulement une revue manuelle.
    """

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.backoffice'
    label = 'backoffice'
