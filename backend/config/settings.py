from datetime import timedelta
from pathlib import Path

from corsheaders.defaults import default_headers
from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config('SECRET_KEY', default='django-insecure-dev-only-change-me')
DEBUG = config('DEBUG', default=False, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1', cast=Csv())

# Déploiement (Render, servi exclusivement en HTTPS) : rattaché à DEBUG,
# jamais un second interrupteur — le dev local (.env.example, DEBUG=True)
# reste en HTTP simple, inchangé. HSTS volontairement PAS activé ici
# (SECURE_HSTS_SECONDS) : irréversible côté navigateur une fois servi,
# risque jugé disproportionné pour un premier déploiement — à activer
# consciemment plus tard si besoin, jamais par défaut.
SECURE_SSL_REDIRECT = not DEBUG
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
# Requis dès que SECURE_SSL_REDIRECT est actif derrière un proxy qui
# termine le TLS lui-même (Render : la connexion interne app<-proxy est en
# clair) — sans ça, Django ne voit jamais une requête comme "déjà HTTPS"
# et boucle indéfiniment sur sa propre redirection. `X-Forwarded-Proto` est
# l'en-tête standard posé par Render (et la plupart des proxys/CDN).
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'apps.accounts',
    'apps.organizations',
    'apps.programs',
    'apps.trust',
    'apps.evidence',
    'apps.inspections',
    'apps.tasks',
    'apps.home',
    'apps.build',
    'apps.control',
    'apps.messaging',
    'apps.backoffice',
    'apps.support',
    'apps.procurement',
    'apps.pricing',
    'apps.core',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    # Déploiement (Render, voir DEPLOY_RENDER.md) : sert STATIC_ROOT
    # directement depuis le process gunicorn, aucun service statique/CDN
    # séparé. Sans effet en dev (runserver sert déjà les statiques lui-même,
    # cette middleware ne fait qu'ajouter un fallback jamais atteint).
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # Doit tourner après AuthenticationMiddleware/DRF JWT auth : résout
    # l'organisation active du membership et pose la session var Postgres
    # utilisée par les policies RLS. Voir apps/core/middleware.py.
    'apps.core.middleware.OrganizationScopeMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DB_NAME', default='keya_ecosystem_db'),
        'USER': config('DB_USER', default='keya_ecosystem_user'),
        'PASSWORD': config('DB_PASSWORD', default='keya_ecosystem_password'),
        'HOST': config('DB_HOST', default='localhost'),
        'PORT': config('DB_PORT', default='5433'),
    }
}

AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'fr-fr'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
# Déploiement (Render) : cible de `collectstatic` (lancé au build), servie
# par WhiteNoise en production. Absent avant ce point — aucune config de
# déploiement n'existait dans ce repo, voir DEPLOY_RENDER.md.
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# MEDIA_URL n'est délibérément jamais monté dans config/urls.py (pas de
# `static(MEDIA_URL, document_root=MEDIA_ROOT)`) : aucune route ne doit
# jamais servir un fichier de apps.evidence.Document de façon non signée —
# voir ticket 004, critère d'acceptation sur sensitivity_level. Le seul accès
# possible passe par apps/evidence/views.py (URL signée + permission
# revérifiée à chaque téléchargement).
MEDIA_ROOT = config('MEDIA_ROOT', default=str(BASE_DIR / 'media'))
MEDIA_URL = '/media/'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
}

CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS', default='', cast=Csv())
# Trouvé en marge du ticket 020 (première vérification RÉELLE en navigateur
# du header X-Organization-Id, ticket 019 — les tests unitaires mockent
# `fetch`, donc n'exercent jamais un vrai préflight CORS) : django-cors-
# headers n'autorise, par défaut, que ses `default_headers` (accept,
# authorization, content-type...) — un header personnalisé comme
# `X-Organization-Id` (apps.core.middleware.OrganizationScopeMiddleware)
# fait échouer le préflight CORS SILENCIEUSEMENT dès qu'une organisation
# active est connue côté frontend (`fetch` lève une erreur réseau générique,
# jamais une réponse HTTP lisible) — CHAQUE requête suivante d'une app
# HOME/BUILD échouait, dès l'instant où l'App Switcher (ticket 019) avait
# résolu une organisation.
CORS_ALLOW_HEADERS = list(default_headers) + ['x-organization-id']

# ── Celery (ticket 004 : traitement asynchrone média) ──────────────────────
# Broker Redis réel depuis l'ADR 0001 (docs/adr/0001-celery-eager-mode.md) :
# `docker run -d --name keyimmo-redis -p 6379:6379 redis:7-alpine`, ou
# `docker-compose up redis`. CELERY_TASK_ALWAYS_EAGER=False par défaut — les
# tâches passent réellement par le broker. `settings_test.py` repasse ce
# flag à True pour la majorité des tests (rapides, exécution synchrone dans
# la transaction de test) ; seuls les tests d'intégration dédiés
# (apps/evidence/tests_celery_integration.py) le forcent à False pour
# exercer un vrai worker.
CELERY_BROKER_URL = config('CELERY_BROKER_URL', default='redis://localhost:6379/0')
CELERY_RESULT_BACKEND = config('CELERY_RESULT_BACKEND', default=CELERY_BROKER_URL)
CELERY_TASK_ALWAYS_EAGER = config('CELERY_TASK_ALWAYS_EAGER', default=False, cast=bool)
CELERY_TASK_EAGER_PROPAGATES = True
