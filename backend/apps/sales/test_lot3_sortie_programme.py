"""Lot 3 — PO-2026-09-28-61 (P14, CDC §9.2 étape 9) : la sortie du compte du
programme vers le constructeur est présentée au client comme telle, jamais
comme sa dette personnelle."""
import pytest
from django.urls import reverse

from apps.core.rls import set_rls_context
from apps.programs.models import Lot

from .tests import (
    _executed_disbursement, _issue, _pay, _register, _sales_scenario,
)


def _scenario_with_client():
    client, _client_user, adv, finance, promoter, lot, reservation_id, fee_call = _sales_scenario()
    _pay(finance, promoter, reservation_id, fee_call['id'], '100000.00')
    complement = _issue(adv, reservation_id, promoter, 'premier_versement').data
    _pay(finance, promoter, reservation_id, complement['id'], '2900000.00')
    constructeur, constructeur_user, constructeur_org = _register('constructeur')
    set_rls_context(organization_id=promoter.id)
    Lot.objects.filter(id=lot['id']).update(assigned_organization=constructeur_org)
    program_id = Lot.objects.select_related('asset').get(id=lot['id']).asset.program_id
    s = {
        'adv': adv, 'finance': finance, 'promoter': promoter, 'lot': lot, 'program_id': program_id,
        'constructeur': constructeur, 'constructeur_user': constructeur_user, 'constructeur_org': constructeur_org,
    }
    return client, reservation_id, s


def _worksite(client, reservation_id):
    response = client.get(reverse('my-worksite', args=[reservation_id]))
    assert response.status_code == 200, response.data
    return {row['code']: row for row in response.data}


@pytest.mark.django_db
class TestProgramOutflowShownToTheClient:
    def test_no_outflow_before_any_disbursement(self):
        client, reservation_id, _s = _scenario_with_client()

        assert all(row['program_outflows'] == [] for row in _worksite(client, reservation_id).values())

    def test_an_executed_disbursement_appears_as_a_programme_outflow_on_its_milestone(self):
        client, reservation_id, s = _scenario_with_client()
        milestone, executed = _executed_disbursement(s)

        rows = _worksite(client, reservation_id)

        outflows = rows[milestone.code]['program_outflows']
        assert outflows == [{
            'amount': '1000000.00', 'currency': 'XOF', 'executed_on': executed['executed_on'],
            'beneficiary': s['constructeur_org'].name, 'reconciled': False, 'simulation': True,
        }]
        assert all(row['program_outflows'] == [] for code, row in rows.items() if code != milestone.code)

    def test_the_outflow_never_becomes_a_payment_call_to_the_client(self):
        client, reservation_id, s = _scenario_with_client()
        _executed_disbursement(s)

        calls = client.get(reverse('my-payment-calls', args=[reservation_id])).data

        assert [call['kind'] for call in calls] == ['frais', 'premier_versement']
