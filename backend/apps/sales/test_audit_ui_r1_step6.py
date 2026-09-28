"""Audit UI R1 — étape 6 : décisions du Product Owner (PO-2026-09-28-20 à 29).

Chaque classe cite la décision liée.
"""
import re

import pytest
from django.urls import reverse

from apps.core.rls import set_rls_context
from apps.programs.models import Lot

from .test_audit_ui_r1 import ADMIN, ADV, FINANCE, _declared_foundations, _login
from .test_audit_ui_r1_step2 import _reserve_and_examine, _signal_fees
from .test_audit_ui_r1_step4 import _notice_url, _record_receipt

EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')


@pytest.mark.django_db
class TestNoEmailInBackOfficeLists:
    """PO-2026-09-28-22 — test de garde : aucune liste du back-office
    n'expose d'e-mail (« organisation · rôle ») ; seule exception,
    Administration › Utilisateurs, où l'e-mail est l'identifiant de
    connexion."""

    def _played_scenario(self):
        client, adv, promoter, reservation_id = _reserve_and_examine()
        notice = _signal_fees(client, reservation_id)
        finance = _login(FINANCE)
        receipt = _record_receipt(finance, promoter, reservation_id)
        attached = finance.post(
            _notice_url('finance-payment-notice-attach', notice['id'], promoter), {'receipt': receipt['id']}, format='json',
        )
        assert attached.status_code == 200, attached.data
        # Mission EN ATTENTE (contrôleur affecté, pas encore d'avis).
        _declared_foundations()
        set_rls_context(organization_id=promoter.id)
        program_id = str(Lot.objects.filter(organization=promoter).first().asset.program_id)
        return promoter, reservation_id, program_id

    def test_every_back_office_list_names_people_without_email(self):
        promoter, reservation_id, program_id = self._played_scenario()
        org = f'?organization_id={promoter.id}'
        adv, finance, admin = _login(ADV), _login(FINANCE), _login(ADMIN)
        lists = [
            (adv, reverse('reservation-admin-list')),
            (adv, f'/api/reservations/{reservation_id}/contracts/admin/{org}'),
            (adv, f'/api/reservations/{reservation_id}/payment-calls/admin/{org}'),
            (adv, '/api/backoffice/controls/'),
            (adv, '/api/backoffice/inspectors/'),
            (adv, '/api/me/tasks/inbox/'),
            (adv, '/api/programs/admin/lots/?q=Lot'),
            (finance, '/api/finance/payment-notices/?status=all'),
            (finance, '/api/finance/receipts/'),
            (finance, f'/api/finance/reservations/{reservation_id}/{org}'),
            (finance, '/api/finance/accounts/'),
            (finance, f'/api/finance/programs/{program_id}/account/{org}'),
            (finance, '/api/me/tasks/inbox/'),
            (admin, '/api/admin/journal/'),
            (admin, '/api/tasks/admin-inbox/'),
        ]
        for api, url in lists:
            response = api.get(url)
            assert response.status_code == 200, (url, response.status_code)
            found = EMAIL.findall(str(response.data))
            assert found == [], f'{url} expose des e-mails : {sorted(set(found))}'
        controls = adv.get('/api/backoffice/controls/').data
        assert any(row['pending_mission'] and row['pending_mission']['inspector'] ==
                   'Bureau de contrôle Démonstration · Contrôleur' for row in controls)
        journal = admin.get('/api/admin/journal/').data
        assert any(entry['actor'] == 'KEYIMMO AFRIC (démo) · Finance' for entry in journal)

    def test_the_users_page_keeps_the_login_email(self):
        _reserve_and_examine()
        users = _login(ADMIN).get('/api/backoffice/users/?q=demo').data
        assert any(user['email'] == 'adv.demo@keya.test' for user in users)
