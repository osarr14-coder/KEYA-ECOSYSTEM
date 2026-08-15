# Postgres est obligatoire en test dès qu'une policy RLS est en jeu (ticket 001) :
# SQLite ne supporte pas RLS, un test qui passerait dessus ne prouverait rien.
from .settings import *  # noqa: F401,F403
