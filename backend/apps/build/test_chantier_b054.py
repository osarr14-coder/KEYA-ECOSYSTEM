"""Ticket B-054 — lectures du chantier : jalons côté constructeur, contrôles
à affecter et contrôleurs côté admin. Parcours réel par l'API (déclaration,
pièce, affectation, correction), l'inspection passant par le service
(la synchronisation CONTROL a ses propres tests)."""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.core.rls import set_rls_context
from apps.inspections.services import create_inspection
from apps.inspections.testing import designated_pieces
from apps.sales.testing import commit_lot

from .tests import _register, _setup_org_with_lot

_counter = 0


def _pdf():
    global _counter
    _counter += 1
    return SimpleUploadedFile(f'pv-{_counter}.pdf', f'%PDF-1.4\n% piece {_counter}\n%%EOF\n'.encode(), content_type='application/pdf')


def _milestones(client, lot):
    response = client.get(reverse('build-lot-milestones', args=[lot.id]))
    assert response.status_code == 200, response.data
    return {row['code']: row for row in response.data}


def _add_evidence(client, declaration_id):
    document = client.post(
        reverse('document-list'), {'file': _pdf(), 'category': 'rapport_chantier', 'source': 'mobile_app_photo'},
        format='multipart',
    )
    assert document.status_code == 201, document.data
    evidence = client.post(
        reverse('evidence-list'), {'work_declaration': declaration_id, 'documents': [document.data['id']]}, format='json',
    )
    assert evidence.status_code == 201, evidence.data
    return evidence.data['id']


def _control_row(admin, declaration_id):
    return next((row for row in admin.get(reverse('backoffice-control-list')).data
                 if row['work_declaration_id'] == declaration_id), None)


def _assign(admin, organization, declaration_id, inspector):
    return admin.post(reverse('backoffice-mission-create'), {
        'organization': str(organization.id), 'work_declaration': declaration_id, 'assigned_inspector': str(inspector.id),
    }, format='json')


@pytest.mark.django_db
class TestChantierPathB054:
    def _setup(self):
        builder, organization, _user, _program, _asset, lot = _setup_org_with_lot(
            'b054-constructeur@example.com', 'Org B054 Constructeur', role_code='constructeur',
        )
        # Audit UI R1 (R02) : l'affectation des contrôles relève du gestionnaire.
        admin, _admin_org, _admin_user = _register(
            'b054-adv-manager@example.com', 'Org B054 KEYIMMO', role_code='gestionnaire_adv',
        )
        _inspector_client, inspector_org, inspector = _register(
            'b054-inspecteur@example.com', 'Org B054 Controle', role_code='inspecteur',
        )
        commit_lot(lot)  # PO-2026-09-29-09 : chantier ouvert après concrétisation
        return builder, organization, lot, admin, inspector, inspector_org

    def test_declare_document_assign_reserve_correct_and_accept(self):
        builder, organization, lot, admin, inspector, inspector_org = self._setup()
        assert _milestones(builder, lot)['fondations']['status'] == 'not_declared'

        fondations = _milestones(builder, lot)['fondations']
        declared = builder.post(reverse('workdeclaration-list'), {'milestone': fondations['id']}, format='json')
        assert declared.status_code == 201, declared.data
        declaration_id = str(declared.data['id'])
        assert _milestones(builder, lot)['fondations']['status'] == 'awaiting_documents'
        assert _control_row(admin, declaration_id) is None

        _add_evidence(builder, declaration_id)
        row = _milestones(builder, lot)['fondations']
        assert (row['status'], row['evidence_count'], row['control_scheduled']) == ('awaiting_control', 1, False)
        control = _control_row(admin, declaration_id)
        assert control['status'] == 'awaiting_control'
        assert control['pending_mission'] is None
        assert control['organization']['id'] == str(organization.id)

        inspectors = admin.get(reverse('backoffice-inspector-list')).data
        assert any(entry['id'] == str(inspector.id) and 'Org B054 Controle' in entry['organizations'] for entry in inspectors)

        assert _assign(admin, organization, declaration_id, inspector).status_code == 201
        # Adapté selon PO-2026-09-28-22 : « organisation · rôle », jamais l'e-mail.
        assert _control_row(admin, declaration_id)['pending_mission']['inspector'] == 'Org B054 Controle · Contrôleur'
        assert _milestones(builder, lot)['fondations']['control_scheduled'] is True

        create_inspection(
            inspector=inspector, inspector_organization=inspector_org, target_organization_id=organization.id,
            # PO-2026-09-28-20 : versions désignées explicitement.
            examined_evidence_ids=designated_pieces(organization.id, declaration_id=declaration_id),
            work_declaration_id=declaration_id, outcome='avec_reserve', reserves=[{'motif': 'Non-conformité constatée', 'expected_action': 'Corriger puis fournir une nouvelle pièce'}],
        )
        row = _milestones(builder, lot)['fondations']
        assert (row['status'], row['latest_outcome'], row['control_scheduled']) == ('under_reserve', 'avec_reserve', False)
        control = _control_row(admin, declaration_id)
        assert (control['status'], control['correction_submitted'], control['pending_mission']) == ('under_reserve', False, None)

        correction_evidence = _add_evidence(builder, declaration_id)
        correction = builder.post(
            reverse('reservecorrection-list'), {'reserve': row['reserve_id'], 'evidence': correction_evidence}, format='json',
        )
        assert correction.status_code == 201, correction.data
        assert _control_row(admin, declaration_id)['correction_submitted'] is True

        assert _assign(admin, organization, declaration_id, inspector).status_code == 201
        create_inspection(
            inspector=inspector, inspector_organization=inspector_org, target_organization_id=organization.id,
            # PO-2026-09-28-20 : versions désignées explicitement.
            examined_evidence_ids=designated_pieces(organization.id, declaration_id=declaration_id),
            work_declaration_id=declaration_id, outcome='conforme', reserve_id=row['reserve_id'],
            decisions=[{'reserve_id': str(row['reserve_id']), 'decision': 'levee', 'motif': 'Correction vérifiée sur place'}],  # Audit UI R1 (K01) : décision explicite
        )
        set_rls_context(organization_id=organization.id)
        assert _milestones(builder, lot)['fondations']['status'] == 'accepted'
        assert _control_row(admin, declaration_id) is None

    def test_evidence_added_after_acceptance_requires_a_new_review(self):
        builder, organization, lot, admin, inspector, inspector_org = self._setup()
        fondations = _milestones(builder, lot)['fondations']
        declaration_id = str(builder.post(reverse('workdeclaration-list'), {'milestone': fondations['id']}, format='json').data['id'])
        _add_evidence(builder, declaration_id)
        create_inspection(
            inspector=inspector, inspector_organization=inspector_org, target_organization_id=organization.id,
            # PO-2026-09-28-20 : versions désignées explicitement.
            examined_evidence_ids=designated_pieces(organization.id, declaration_id=declaration_id),
            work_declaration_id=declaration_id, outcome='conforme',
        )
        assert _milestones(builder, lot)['fondations']['status'] == 'accepted'

        _add_evidence(builder, declaration_id)

        assert _milestones(builder, lot)['fondations']['status'] == 'awaiting_control'
        assert _control_row(admin, declaration_id)['status'] == 'awaiting_control'


@pytest.mark.django_db
class TestChantierIsolationB054:
    def test_a_constructeur_never_reads_another_organizations_lot(self):
        _builder, _org, _user, _program, _asset, lot = _setup_org_with_lot(
            'b054-a@example.com', 'Org B054 A', role_code='constructeur',
        )
        other, _other_org, _other_user, _p, _a, _other_lot = _setup_org_with_lot(
            'b054-b@example.com', 'Org B054 B', role_code='constructeur',
        )
        assert other.get(reverse('build-lot-milestones', args=[lot.id])).status_code == 404

    def test_controls_and_inspectors_are_reserved_to_the_manager(self):
        # Audit UI R1 (R02) : ni le constructeur, ni l'administrateur.
        builder, _org, _user, _program, _asset, _lot = _setup_org_with_lot(
            'b054-c@example.com', 'Org B054 C', role_code='constructeur',
        )
        admin, _admin_org, _admin_user = _register('b054-admin@example.com', 'Org B054 Admin', role_code='admin_keyimmo')
        for client in (builder, admin):
            assert client.get(reverse('backoffice-control-list')).status_code == 403
            assert client.get(reverse('backoffice-inspector-list')).status_code == 403
        adv, _adv_org, _adv_user = _register('b054-adv@example.com', 'Org B054 ADV', role_code='gestionnaire_adv')
        assert adv.get(reverse('backoffice-control-list')).status_code == 200
        assert adv.get(reverse('backoffice-inspector-list')).status_code == 200
