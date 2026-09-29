"""PO-2026-09-29-11 (T05, CDC §12.1) — une tentative d'écriture refusée
pour un motif de droits (403, 405) est inscrite au journal d'audit, avec
l'acteur, la route, le motif et les identifiants visés ; rien d'autre du
corps de la requête. Les lectures refusées, les visiteurs anonymes et les
écritures réussies ne créent aucune entrée de ce type."""
import uuid

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.build.tests import _register, _setup_org_with_lot
from apps.core.rls import set_rls_context
from apps.inspections.models import Inspection
from apps.sales.testing import commit_lot

from .middleware import ACTION
from .models import AuditEvent


def _denied(organization):
    set_rls_context(organization_id=organization.id)
    return list(AuditEvent.objects.filter(action=ACTION).order_by('id'))


@pytest.mark.django_db
class TestRefusedAttemptsAreJournaled:
    def _declared(self, suffix):
        builder, organization, user, _program, _asset, lot = _setup_org_with_lot(
            f'refus-{suffix}@example.com', f'Org refus {suffix}', role_code='constructeur',
        )
        commit_lot(lot)
        milestone = lot.milestones.order_by('order').first()
        declared = builder.post(reverse('workdeclaration-list'), {'milestone': str(milestone.id)}, format='json')
        assert declared.status_code == 201, declared.data
        return builder, organization, user, str(declared.data['id'])

    def test_t05_the_builder_accepting_his_own_milestone_is_refused_and_journaled(self):
        builder, organization, user, declaration_id = self._declared('t05')

        response = builder.post(reverse('inspection-list'), {
            'organization': str(organization.id), 'work_declaration': declaration_id, 'outcome': 'conforme',
            'note': 'texte libre jamais recopié',
        }, format='json')

        assert response.status_code == 403
        set_rls_context(organization_id=organization.id)
        assert not Inspection.objects.exists()
        [event] = _denied(organization)
        assert event.actor_id == user.id
        assert event.organization_id == organization.id
        assert event.object_type == 'route:inspection-list'
        assert event.payload['method'] == 'POST'
        assert event.payload['status'] == 403
        assert 'inspecteur' in event.payload['reason']
        assert event.payload['body_identifiers'] == {
            'organization': str(organization.id), 'work_declaration': declaration_id,
        }
        assert 'texte libre' not in str(event.payload)

    def test_an_operation_not_offered_is_journaled_with_its_target(self):
        builder, organization, user, _declaration_id = self._declared('methode')
        reserve_id = str(uuid.uuid4())

        response = builder.patch(f'/api/reserves/{reserve_id}/', {'status': 'levee'}, format='json')

        assert response.status_code == 405
        [event] = _denied(organization)
        assert (event.object_type, str(event.object_id)) == ('route:reserve-detail', reserve_id)
        assert event.payload['status'] == 405
        assert event.payload['url_identifiers'] == {'pk': reserve_id}

    def test_reads_successes_and_anonymous_requests_are_not_journaled(self):
        builder, organization, _user, _declaration_id = self._declared('hors')
        assert builder.get(reverse('admin-journal')).status_code == 403
        assert APIClient().post(reverse('inspection-list'), {}, format='json').status_code == 401

        assert _denied(organization) == []

    def test_the_administrator_reads_the_attempt_in_the_journal(self):
        builder, organization, _user, declaration_id = self._declared('journal')
        builder.post(reverse('inspection-list'), {
            'organization': str(organization.id), 'work_declaration': declaration_id, 'outcome': 'conforme',
        }, format='json')
        admin, _admin_org, _admin = _register('refus-admin@example.com', 'KEYIMMO refus', role_code='admin_keyimmo')

        rows = admin.get(reverse('admin-journal')).data

        [row] = [r for r in rows if r['action'] == ACTION]
        assert row['action_label'] == 'Tentative refusée (droits insuffisants)'
        assert row['organization'] == 'Org refus journal'
        assert row['actor']
