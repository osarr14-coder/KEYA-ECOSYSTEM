"""PO-2026-09-29-10 (T16) — contrôle « journal hors de portée du compte
applicatif ». La protection elle-même (`scripts/sql/protect_journal.sql`)
est posée par un administrateur Postgres et ne peut pas l'être par le
compte de test ; ces tests prouvent que le contrôle la détecte, dans les
deux sens, et qu'il échoue sur une base non protégée comme celle des tests."""
import copy

import pytest
from django.core.management import CommandError, call_command

from .journal_protection import FORBIDDEN_PRIVILEGES, evaluate

PROTECTED = {
    'role': 'keya_ecosystem_app',
    'database_owner': False,
    'schema_owner': False,
    'tables': {
        table: {
            'owner': False, 'rls': True, 'force_rls': True, 'enabled_triggers': 2,
            'privileges': {'SELECT': True, 'INSERT': True, **{p: False for p in FORBIDDEN_PRIVILEGES}},
        }
        for table in ('audit_event', 'trust_event')
    },
    'functions': {'audit_event_reject_mutation': False, 'trust_event_reject_mutation': False},
}


def _failed(facts):
    return [label for ok, label in evaluate(facts) if not ok]


def test_a_protected_journal_passes_every_check():
    assert _failed(PROTECTED) == []


@pytest.mark.parametrize('breach, expected', [
    (lambda f: f.update(database_owner=True), 'ne possède pas la base'),
    (lambda f: f.update(schema_owner=True), 'ne possède pas le schéma public'),
    (lambda f: f['tables']['audit_event'].update(owner=True), 'audit_event : keya_ecosystem_app n’en est pas propriétaire'),
    (lambda f: f['tables']['trust_event']['privileges'].update(TRUNCATE=True), 'trust_event : ni UPDATE, ni DELETE, ni TRUNCATE'),
    (lambda f: f['tables']['audit_event']['privileges'].update(UPDATE=True), 'audit_event : ni UPDATE, ni DELETE, ni TRUNCATE'),
    (lambda f: f['tables']['audit_event'].update(force_rls=False), 'audit_event : RLS active et forcée'),
    (lambda f: f['tables']['trust_event'].update(enabled_triggers=1), 'trust_event : triggers anti-modification'),
    (lambda f: f['functions'].update(audit_event_reject_mutation=True), 'audit_event_reject_mutation() : keya_ecosystem_app'),
    (lambda f: f['tables']['audit_event']['privileges'].update(INSERT=False), 'audit_event : lecture et ajout accordés'),
])
def test_each_way_to_alter_the_journal_is_reported(breach, expected):
    facts = copy.deepcopy(PROTECTED)
    breach(facts)
    failed = _failed(facts)
    assert len(failed) == 1
    assert failed[0].startswith(expected) or expected in failed[0]


@pytest.mark.django_db
def test_the_command_fails_on_a_database_the_application_account_owns(capsys):
    # La base de test est créée et possédée par le compte qui s'y connecte :
    # exactement la situation relevée par la revue assistée (T16).
    with pytest.raises(CommandError, match='Journal non protégé'):
        call_command('check_journal_protection')
    out = capsys.readouterr().out
    assert 'MANQUE  ' in out and 'ne possède pas le schéma public' in out
    assert 'audit_event : RLS active et forcée' in out and 'OK      audit_event : RLS active et forcée' in out
