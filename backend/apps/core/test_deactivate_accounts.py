"""PO-2026-09-30-12 — `deactivate_out_of_set_accounts` : liste sans rien
écrire par défaut ; désactive exactement la liste présentée, sur code et
sauvegarde C1 ; jamais de suppression ; tracé au journal ; réversible."""
import io
import re

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.core.rls import set_rls_context
from apps.core.test_out_of_instance import OLD_ACCOUNT, PASSWORD, seeded  # noqa: F401
from apps.organizations.models import Organization
from apps.sales.management.commands.seed_demo_scenario import ACCOUNTS, KEYIMMO_ORG

ADMIN_EMAIL = 'exploitation@keya.test'


def _run(*args):
    out = io.StringIO()
    call_command('deactivate_out_of_set_accounts', '--admin-email', ADMIN_EMAIL, *args, stdout=out)
    return out.getvalue()


def _code(output):
    return re.search(r'Code de cette liste : (\w+)', output).group(1)


def _login_status(email):
    return APIClient().post('/api/auth/login/', {'email': email, 'password': PASSWORD}, format='json').status_code


@pytest.fixture
def outsiders(seeded):  # noqa: F811
    User.objects.create_user(email=OLD_ACCOUNT, password=PASSWORD)
    User.objects.create_user(email=ADMIN_EMAIL, password=PASSWORD)


@pytest.fixture
def backup(tmp_path):
    path = tmp_path / 'keya-render-c1.dump'
    path.write_bytes(b'PGDMP')
    return str(path)


@pytest.mark.django_db
def test_by_default_it_lists_and_writes_nothing(outsiders):
    output = _run()
    assert OLD_ACCOUNT in output
    assert ADMIN_EMAIL not in output
    assert not any(email in output for email, *_ in ACCOUNTS)
    assert 'Rien n’a été modifié' in output
    assert User.objects.get(email=OLD_ACCOUNT).is_active


@pytest.mark.django_db
@pytest.mark.parametrize('case', ['code', 'sauvegarde', 'admin'])
def test_applying_is_refused_without_the_listed_code_the_backup_or_the_admin_account(outsiders, backup, case):
    code = _code(_run())
    args = ['--appliquer', '--code', 'mauvais' if case == 'code' else code]
    if case != 'sauvegarde':
        args += ['--sauvegarde', backup]
    with pytest.raises(CommandError, match='Refus'):
        if case == 'admin':
            call_command('deactivate_out_of_set_accounts', '--admin-email', '', *args, stdout=io.StringIO())
        else:
            _run(*args)
    assert User.objects.get(email=OLD_ACCOUNT).is_active


@pytest.mark.django_db
def test_a_list_changed_since_it_was_shown_is_not_applied(outsiders, backup):
    code = _code(_run())
    User.objects.create_user(email='autre@ancien.test', password=PASSWORD)
    with pytest.raises(CommandError, match='code ne correspond pas'):
        _run('--appliquer', '--code', code, '--sauvegarde', backup)
    assert User.objects.get(email=OLD_ACCOUNT).is_active


@pytest.mark.django_db
def test_applying_deactivates_journals_and_can_be_reversed(outsiders, backup):
    assert _login_status(OLD_ACCOUNT) == 200
    output = _run('--appliquer', '--code', _code(_run()), '--sauvegarde', backup)
    assert f'Désactivé : {OLD_ACCOUNT}' in output

    old = User.objects.get(email=OLD_ACCOUNT)  # conservé
    assert not old.is_active
    assert _login_status(OLD_ACCOUNT) != 200
    assert _login_status('adv.demo@keya.test') == 200
    assert User.objects.get(email=ADMIN_EMAIL).is_active
    set_rls_context(organization_id=Organization.objects.get(name=KEYIMMO_ORG).id)
    assert AuditEvent.objects.filter(action='account.deactivated', object_id=old.id).count() == 1

    call_command('deactivate_out_of_set_accounts', '--reactiver', OLD_ACCOUNT, stdout=io.StringIO())
    assert User.objects.get(email=OLD_ACCOUNT).is_active
    assert AuditEvent.objects.filter(action='account.reactivated', object_id=old.id).count() == 1
