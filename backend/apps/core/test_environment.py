"""PO-2026-09-30-08 — KEYA_ENVIRONMENT n'a pas de valeur par défaut : absent
ou invalide, l'application refuse de démarrer avec un message clair."""
import os
import subprocess
import sys

import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from config.environment import read_environment


def _start(**env):
    """Démarre Django avec les réglages de production (config.settings)."""
    code = 'import django; django.setup(); from django.conf import settings; print(settings.KEYA_ENVIRONMENT)'
    environ = {**os.environ, 'DJANGO_SETTINGS_MODULE': 'config.settings', **env}
    return subprocess.run(
        [sys.executable, '-c', code], cwd=settings.BASE_DIR, env=environ, capture_output=True, text=True, timeout=120,
    )


@pytest.mark.parametrize('absent', [None, '', '   '])
def test_startup_is_refused_without_a_declared_environment(absent):
    with pytest.raises(ImproperlyConfigured, match='KEYA_ENVIRONMENT absent'):
        read_environment(absent)


def test_the_application_does_not_start_without_a_declared_environment():
    """Démarrage réel : réglage déclaré vide (un .env local, s'il existe,
    ne peut pas le remplacer, la variable d'environnement l'emporte)."""
    run = _start(KEYA_ENVIRONMENT='')
    assert run.returncode != 0
    assert 'KEYA_ENVIRONMENT absent' in run.stderr
    assert 'DEMO, PILOTE ou PRODUCTION' in run.stderr


def test_an_unknown_environment_is_refused():
    run = _start(KEYA_ENVIRONMENT='demo')  # la casse compte
    assert run.returncode != 0
    assert 'KEYA_ENVIRONMENT inconnu' in run.stderr


@pytest.mark.parametrize('environment', ['DEMO', 'PILOTE', 'PRODUCTION'])
def test_a_declared_environment_starts(environment):
    run = _start(KEYA_ENVIRONMENT=environment, KEYA_DEMO_UPLOADS_WITHOUT_ANTIVIRUS='False')
    assert run.returncode == 0, run.stderr
    assert run.stdout.strip() == environment
