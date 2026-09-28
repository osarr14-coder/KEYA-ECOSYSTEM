"""Audit UI R1 — dernière étape avant l'audit du parcours : décisions du
Product Owner PO-2026-09-28-37 à 40. Chaque classe cite la décision liée.
"""
import re
import uuid

import pytest
from django.test import override_settings
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient

from .test_audit_ui_r1 import ADV, _declared_foundations, _login
from .test_audit_ui_r1_step2 import _reserve_and_examine

# Clés qui trahiraient un état de lot, de jalon ou de dossier.
STATE_KEYS = {
    'cdc_state', 'status', 'status_label', 'milestones', 'accepted', 'total', 'reserves', 'reserve',
    'open_reserve_count', 'reservation', 'reservations', 'client', 'trust_levels', 'worksite',
    'commercial_status', 'next_step', 'next_actor', 'inspection', 'declaration',
}


def _api_paths(resolver=None, prefix=''):
    """Toutes les routes `/api/…` du projet, paramètres remplacés par un
    identifiant quelconque."""
    resolver = resolver or get_resolver()
    for pattern in resolver.url_patterns:
        route = prefix + str(pattern.pattern)
        if isinstance(pattern, URLResolver):
            yield from _api_paths(pattern, route)
        elif isinstance(pattern, URLPattern):
            path = re.sub(r'<(?:\w+:)?\w+>', str(uuid.uuid4()), route)
            path = re.sub(r'\(\?P<\w+>[^)]*\)', str(uuid.uuid4()), path)
            path = path.replace('^', '').replace('$', '').replace('\\.', '.')
            if path.startswith('api/') and '(' not in path and '[' not in path:
                yield '/' + path


def _keys(payload):
    if isinstance(payload, dict):
        for key, value in payload.items():
            yield key
            yield from _keys(value)
    elif isinstance(payload, list):
        for item in payload:
            yield from _keys(item)


@pytest.mark.django_db
class TestNoAnonymousRouteExposesAState:
    """PO-2026-09-28-38 — `/api/public/worksites/` coupé (« introuvable ») ;
    aucune route anonyme ne renvoie d'état de lot, de jalon ou de dossier."""

    @override_settings(KEYA_PUBLIC_WORKSITES_ENABLED=False)
    def test_public_worksites_answer_not_found(self):
        _declared_foundations()
        assert APIClient().get('/api/public/worksites/').status_code == 404

    @override_settings(KEYA_PUBLIC_WORKSITES_ENABLED=False)
    def test_no_anonymous_route_returns_a_lot_milestone_or_file_state(self):
        _reserve_and_examine()
        _declared_foundations()  # un chantier en cours, un dossier, une mission
        anonymous = APIClient()
        opened = []
        for path in sorted(set(_api_paths())):
            response = anonymous.get(path)
            if response.status_code != 200 or not hasattr(response, 'data'):
                continue
            opened.append(path)
            payload = response.data
            if path == '/api/public/demo-instance/':
                # Statut de l'INSTANCE de démonstration (bandeau), pas d'un lot.
                payload = {key: value for key, value in payload.items() if key != 'instance'}
            leaked = STATE_KEYS & set(_keys(payload))
            assert not leaked, f'{path} renvoie un état à un anonyme : {sorted(leaked)}'
        # Les seules routes anonymes qui répondent : vitrine et instance démo.
        assert set(opened) <= {'/api/public/offer/', '/api/public/demo-instance/'}, opened

    def test_the_setting_is_off_by_default(self):
        from decouple import config
        from django.conf import settings as project_settings

        assert config('KEYA_PUBLIC_WORKSITES_ENABLED', default=False, cast=bool) is False
        assert hasattr(project_settings, 'KEYA_PUBLIC_WORKSITES_ENABLED')


@pytest.mark.django_db
class TestDemoClientsReadAsFictive:
    """PO-2026-09-28-40 — « Awa Koné · Cliente fictive », « Yao Kouassi ·
    Client fictif » : nom sans mention, rôle venu du jeu de démo."""

    def test_back_office_lists_show_name_then_role_from_the_dataset(self):
        _reserve_and_examine()
        rows = _login(ADV).get('/api/reservations/admin/').data
        rows = rows['results'] if isinstance(rows, dict) else rows
        client = next(row['client'] for row in rows if row['lot']['name'] == 'Lot A1')
        assert client['full_name'] == 'Awa Koné'
        assert client['role'] == 'Cliente fictive'
        assert client['label'] == 'Awa Koné · Cliente fictive'
        assert 'Client(e)' not in str(rows)
