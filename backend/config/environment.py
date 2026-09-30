"""ADR 0004, PO-2026-09-30-08 — environnement du déploiement, déclaré
explicitement : DEMO, PILOTE ou PRODUCTION. Aucune valeur par défaut : un
réglage absent ou invalide empêche l'application de démarrer."""
from django.core.exceptions import ImproperlyConfigured

ENVIRONMENTS = ('DEMO', 'PILOTE', 'PRODUCTION')


def read_environment(value):
    """Valeur de `KEYA_ENVIRONMENT` validée, ou `ImproperlyConfigured`."""
    if value is None or not str(value).strip():
        raise ImproperlyConfigured(
            'KEYA_ENVIRONMENT absent : déclarer l’environnement de ce déploiement '
            '(DEMO, PILOTE ou PRODUCTION) — voir .env.example et render.yaml.'
        )
    if value not in ENVIRONMENTS:
        raise ImproperlyConfigured(f'KEYA_ENVIRONMENT inconnu : {value!r} (DEMO, PILOTE ou PRODUCTION).')
    return value
