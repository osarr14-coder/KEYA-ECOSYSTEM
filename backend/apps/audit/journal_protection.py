"""PO-2026-09-29-10 (T16, CDC §10) — contrôle, depuis le compte applicatif,
que le journal est hors de sa portée : il ne possède ni la base, ni le
schéma, ni les tables `audit_event`/`trust_event`, ni leurs fonctions de
trigger, et n'a sur ces tables que la lecture et l'ajout. Lecture seule.

La protection elle-même est posée par un administrateur Postgres
(`scripts/sql/protect_journal.sql`) : le compte applicatif ne peut pas se
retirer ses propres droits de propriétaire. Voir l'ADR 0005.
"""
from django.db import connection

JOURNAL_TABLES = ('audit_event', 'trust_event')
TRIGGER_FUNCTIONS = ('audit_event_reject_mutation', 'trust_event_reject_mutation')
FORBIDDEN_PRIVILEGES = ('UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')


def collect_facts():
    """Faits lus dans le catalogue Postgres, pour le compte connecté."""
    facts = {'tables': {}, 'functions': {}}
    with connection.cursor() as cursor:
        cursor.execute('SELECT current_user')
        facts['role'] = cursor.fetchone()[0]
        cursor.execute(
            "SELECT pg_has_role(current_user, datdba, 'MEMBER') FROM pg_database WHERE datname = current_database()",
        )
        facts['database_owner'] = cursor.fetchone()[0]
        cursor.execute("SELECT pg_has_role(current_user, nspowner, 'MEMBER') FROM pg_namespace WHERE nspname = 'public'")
        facts['schema_owner'] = cursor.fetchone()[0]
        for table in JOURNAL_TABLES:
            cursor.execute(
                "SELECT pg_has_role(current_user, relowner, 'MEMBER'), relrowsecurity, relforcerowsecurity "
                'FROM pg_class WHERE relname = %s',
                [table],
            )
            owner, rls, force_rls = cursor.fetchone()
            privileges = {}
            for privilege in ('SELECT', 'INSERT', *FORBIDDEN_PRIVILEGES):
                cursor.execute('SELECT has_table_privilege(current_user, %s, %s)', [table, privilege])
                privileges[privilege] = cursor.fetchone()[0]
            cursor.execute(
                "SELECT count(*) FROM pg_trigger WHERE tgrelid = %s::regclass AND NOT tgisinternal AND tgenabled = 'O'",
                [table],
            )
            facts['tables'][table] = {
                'owner': owner, 'rls': rls, 'force_rls': force_rls,
                'privileges': privileges, 'enabled_triggers': cursor.fetchone()[0],
            }
        for function in TRIGGER_FUNCTIONS:
            cursor.execute("SELECT pg_has_role(current_user, proowner, 'MEMBER') FROM pg_proc WHERE proname = %s", [function])
            facts['functions'][function] = cursor.fetchone()[0]
    return facts


def evaluate(facts):
    """Liste de `(conforme, libellé)` ; conforme = le compte applicatif ne
    peut ni modifier ni supprimer le journal."""
    role = facts['role']
    checks = [
        (not facts['database_owner'], f'{role} ne possède pas la base'),
        (not facts['schema_owner'], f'{role} ne possède pas le schéma public (il ne peut pas supprimer une table du journal)'),
    ]
    for table, t in facts['tables'].items():
        checks += [
            (not t['owner'], f'{table} : {role} n’en est pas propriétaire'),
            (t['privileges']['SELECT'] and t['privileges']['INSERT'], f'{table} : lecture et ajout accordés'),
            (not any(t['privileges'][p] for p in FORBIDDEN_PRIVILEGES),
             f'{table} : ni UPDATE, ni DELETE, ni TRUNCATE, ni TRIGGER, ni REFERENCES'),
            (t['rls'] and t['force_rls'], f'{table} : RLS active et forcée'),
            (t['enabled_triggers'] >= 2, f'{table} : triggers anti-modification et anti-suppression actifs'),
        ]
    for function, owned in facts['functions'].items():
        checks.append((not owned, f'{function}() : {role} n’en est pas propriétaire (il ne peut pas la réécrire)'))
    return checks
