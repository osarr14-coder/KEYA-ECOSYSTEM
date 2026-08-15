# Postgres est obligatoire en test dès qu'une policy RLS est en jeu (ticket 001) :
# SQLite ne supporte pas RLS, un test qui passerait dessus ne prouverait rien.
import tempfile

from .settings import *  # noqa: F401,F403

# Fichiers uploadés en test écrits dans un dossier temporaire système, hors
# du repo — jamais dans MEDIA_ROOT réel (ticket 004).
MEDIA_ROOT = tempfile.mkdtemp(prefix='keya_ecosystem_test_media_')
