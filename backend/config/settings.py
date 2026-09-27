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
    'apps.audit',
    'apps.sales',
    'apps.core',
]

# Ticket B-048 — durée de blocage d'une réservation (CDC V3 §6.1 :
# « paramètre visible du scénario, proposé à 24 heures, sans valeur
# juridique »). Exposée au client via `Reservation.held_until`.
RESERVATION_HOLD_HOURS = config('RESERVATION_HOLD_HOURS', default=24, cast=int)

# Ticket B-050 — frais de réservation du scénario (CDC V3 §9.1 : « frais
# 100 000 XOF inclus dans un premier versement de 3 000 000 XOF »). Donnée de
# présentation, sans portée commerciale ni réglementaire. Le premier
# versement, lui, vient du barème légal actif (plafond du premier palier).
RESERVATION_FEE_AMOUNT = config('RESERVATION_FEE_AMOUNT', default='100000')

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
    # Ticket B-046 (CDC §10) — bourrage d'identifiants sur /api/auth/login/
    # confirmé sans aucune protection avant ce ticket. `login` est le scope
    # utilisé par apps.accounts.views.ThrottledLoginView (ScopedRateThrottle,
    # par IP pour cet endpoint anonyme). `register` (B-047) : l'inscription
    # révèle si un email a déjà un compte, elle permettait d'énumérer les
    # comptes sans limite. Désactivés en tests, voir config/settings_test.py.
    'DEFAULT_THROTTLE_RATES': {
        'login': '5/min',
        'register': '20/hour',
    },
    # Ticket B-047 — SANS ce réglage, DRF identifie l'appelant par
    # l'en-tête X-Forwarded-For ENTIER, que le client choisit librement :
    # changer sa valeur à chaque tentative contournait le throttle (reproduit
    # par la revue indépendante de B-046). Avec N proxys de confiance, DRF
    # prend l'adresse ajoutée par le N-ième proxy en partant de la fin — jamais
    # une valeur fournie par le client. Défaut 1 = le proxy Render ; à
    # confirmer sur le déploiement réel (voir ticket B-047, « À confirmer au
    # déploiement »). Sans proxy (dev local), aucun X-Forwarded-For n'est
    # posé et DRF retombe sur REMOTE_ADDR.
    'NUM_PROXIES': config('NUM_PROXIES', default=1, cast=int),
}

# Ticket B-047 — cache partagé en base pour les compteurs de throttle. Le
# cache par défaut (LocMemCache) est propre à CHAQUE processus gunicorn
# (limite multipliée par le nombre de workers) et vidé à chaque mise en
# veille de l'instance Render free. Table créée par `createcachetable`
# (render.yaml, buildCommand ; créée automatiquement pour la base de test).
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
        'LOCATION': 'keya_cache',
    },
}

# Ticket B-047 — `MaxSizeUploadHandler` EN PREMIER : coupe l'écriture d'un
# fichier au-delà de 10 Mo PENDANT la réception, avant que les gestionnaires
# par défaut (mémoire, puis fichier temporaire) ne l'aient stocké en entier.
FILE_UPLOAD_HANDLERS = [
    'apps.evidence.upload_handlers.MaxSizeUploadHandler',
    'django.core.files.uploadhandler.MemoryFileUploadHandler',
    'django.core.files.uploadhandler.TemporaryFileUploadHandler',
]

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
}

CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS', default='', cast=Csv())

# Ticket B-055 — la racine du backend (`/`) n'avait aucune page : ouverte par
# erreur à la place de l'application, elle affichait le 404 brut de Django
# (retour utilisateur). Si défini, `/` redirige vers l'application web
# (écran de connexion) ; sinon, une courte réponse JSON indique que c'est
# l'API.
WEB_APP_URL = config('WEB_APP_URL', default='')
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
