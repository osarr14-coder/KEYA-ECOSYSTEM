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


# ─── PO-2026-09-28-27 : jauge des jalons (états serveur, prochaine étape) ────

from apps.evidence.services import create_evidence  # noqa: E402
from apps.inspections import services as inspections_services  # noqa: E402

from .test_audit_ui_r1 import CONSTRUCTEUR  # noqa: E402
from .test_audit_ui_r1_step4 import _committed  # noqa: E402
from .tests import _accept_milestone  # noqa: E402

PERCENT_OR_RATIO = re.compile(r'%|\bpercent|\bratio|\bprogress', re.I)


class TestMilestoneNextStep:
    """PO-2026-09-28-27 — « Prochaine étape » et « Qui agit » par état CDC."""

    @pytest.mark.parametrize(('cdc_state', 'scheduled', 'expected'), [
        ('DRAFT', False, ('Déclaration de «\u00a0Fondations\u00a0»', 'Constructeur')),
        ('SUBMITTED', False, ('Affectation d’un contrôleur («\u00a0Fondations\u00a0»)', 'Gestionnaire')),
        ('UNDER_REVIEW', True, ('Avis sur «\u00a0Fondations\u00a0»', 'Contrôleur')),
        ('CHANGES_REQUESTED', False, ('Correction de la réserve («\u00a0Fondations\u00a0»)', 'Constructeur')),
        # Adapté selon PO-2026-09-28-33 : « Gestionnaire (affectation du contrôle) ».
        ('RESUBMITTED', False, ('Recontrôle de «\u00a0Fondations\u00a0»', 'Gestionnaire (affectation du contrôle)')),
        ('RESUBMITTED', True, ('Recontrôle de «\u00a0Fondations\u00a0»', 'Contrôleur')),
        ('REVIEW_REQUIRED', False, ('Nouvelle revue de «\u00a0Fondations\u00a0»', 'Gestionnaire (affectation du contrôle)')),
    ])
    def test_each_state_names_the_next_step_and_who_acts(self, cdc_state, scheduled, expected):
        assert inspections_services.milestone_next_step('Fondations', cdc_state, scheduled) == expected

    def test_the_lot_follows_its_first_milestone_not_accepted(self):
        rows = [
            {'label': 'Fondations', 'cdc_state': 'TECHNICALLY_ACCEPTED'},
            {'label': 'Élévation', 'cdc_state': 'DRAFT'},
        ]
        assert inspections_services.lot_next_step(rows) == ('Déclaration de «\u00a0Élévation\u00a0»', 'Constructeur')
        rows[1]['cdc_state'] = 'TECHNICALLY_ACCEPTED'
        assert inspections_services.lot_next_step(rows) == ('Tous les jalons sont acceptés techniquement', '—')


@pytest.mark.django_db
class TestMilestoneGaugeFromServerState:
    """PO-2026-09-28-27 — la jauge ne lit que le `cdc_state` du serveur."""

    def test_a_piece_added_after_acceptance_requires_a_new_review_T07(self):
        _client, _adv, promoter, lot, _reservation_id = _committed()
        milestone, declaration, inspector = _accept_milestone(promoter, lot['id'], 'fondations')
        set_rls_context(organization_id=promoter.id)
        lot_object = Lot.objects.get(id=lot['id'])
        def fondations_row():
            return next(row for row in inspections_services.milestone_gauge_rows(lot_object) if row['code'] == 'fondations')

        assert fondations_row()['cdc_state'] == 'TECHNICALLY_ACCEPTED'

        create_evidence(organization=promoter, work_declaration=declaration, documents=[], added_by=inspector)

        set_rls_context(organization_id=promoter.id)
        fondations = fondations_row()
        assert fondations['cdc_state'] == 'REVIEW_REQUIRED'
        # Adapté selon PO-2026-09-28-31 : vocabulaire du CDC §7.1.
        assert fondations['status_label'] == 'Nouvelle revue nécessaire'
        # Jamais « accepté » : la jauge et les appels de palier suivent le serveur.
        assert inspections_services.is_milestone_technically_accepted(milestone) is False
        assert inspections_services.milestone_next_step(
            fondations['label'], fondations['cdc_state'], fondations['control_scheduled'],
        ) == (f'Nouvelle revue de «\u00a0{fondations["label"]}\u00a0»', 'Gestionnaire (affectation du contrôle)')  # PO-2026-09-28-33

    def test_build_and_manager_lists_carry_the_gauge_and_the_next_step(self):
        _reserve_and_examine()
        _declared_foundations()  # mission affectée, en attente d'avis
        build_rows = _login(CONSTRUCTEUR).get(reverse('build-lots') + '?page_size=100').data
        build_rows = build_rows['results'] if isinstance(build_rows, dict) else build_rows
        a1 = next(row for row in build_rows if row['name'] == 'Lot A1')
        assert [(row['code'], row['cdc_state']) for row in a1['milestones']][0] == ('fondations', 'UNDER_REVIEW')
        assert (a1['next_step'], a1['next_actor']) == ('Avis sur «\u00a0Fondations\u00a0»', 'Contrôleur')

        reservations = _login(ADV).get(reverse('reservation-admin-list')).data
        reservations = reservations['results'] if isinstance(reservations, dict) else reservations
        worksite = next(row['worksite'] for row in reservations if row['lot']['name'] == 'Lot A1')
        assert worksite['milestones'][0]['cdc_state'] == 'UNDER_REVIEW'
        assert (worksite['accepted_milestone_count'], worksite['milestone_count']) == (0, len(worksite['milestones']))
        assert (worksite['next_step'], worksite['next_actor']) == ('Avis sur «\u00a0Fondations\u00a0»', 'Contrôleur')
        # Aucun pourcentage, aucun ratio calculé : « n / N » reste deux entiers.
        assert not PERCENT_OR_RATIO.search(' '.join(str(key) for key in worksite))
        assert all(row['cdc_state'] in inspections_services.CDC_STATE_LABELS for row in worksite['milestones'])
