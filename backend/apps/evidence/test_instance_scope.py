"""PO-2026-09-29-12 (A6) — le constructeur ne voit que l'instance active.

Constat de la revue assistée (docs/recette/REVUE_ASSISTEE_R1.md) : par les
routes génériques (documents, pièces, déclarations), le constructeur
listait et téléchargeait les objets des instances archivées. Seuls
l'administrateur et le gestionnaire consultent une archive (lot 5)."""
import pytest
from django.urls import reverse

from apps.core.demo import active_demo_instance
from apps.core.rls import set_rls_context
from apps.core.test_lot5_archive import _archive, _played_instance
from apps.programs.models import Lot
from apps.sales.test_audit_ui_r1 import CONSTRUCTEUR, _add_evidence, _login, _promoter_lot
from apps.sales.test_lot2_relais import _declare_foundations

ROUTES = ('document-list', 'evidence-list', 'workdeclaration-list', 'inspection-list', 'reserve-list', 'reservecorrection-list')


def _ids(client, route):
    response = client.get(reverse(route))
    assert response.status_code == 200, response.data
    rows = response.data['results'] if isinstance(response.data, dict) and 'results' in response.data else response.data
    return {str(row['id']) for row in rows}


def _path(url):
    return '/' + url.split('://', 1)[-1].split('/', 1)[-1] if '://' in url else url


@pytest.mark.django_db
class TestBuilderSeesTheActiveInstanceOnly:
    def test_archived_objects_leave_every_builder_list_detail_and_download(self):
        _promoter, _reservation_id, declaration_id = _played_instance()
        builder = _login(CONSTRUCTEUR)
        before = {route: _ids(builder, route) for route in ROUTES}
        assert declaration_id in before['workdeclaration-list']
        [document_id] = before['document-list']
        link = builder.get(reverse('document-signed-url', args=[document_id])).data['url']
        assert builder.get(_path(link)).status_code == 200

        _old, response = _archive()
        assert response.status_code == 201, response.data

        builder = _login(CONSTRUCTEUR)
        assert {route: _ids(builder, route) for route in ROUTES} == {route: set() for route in ROUTES}
        assert builder.get(reverse('workdeclaration-detail', args=[declaration_id])).status_code == 404
        assert builder.get(reverse('document-detail', args=[document_id])).status_code == 404
        assert builder.get(reverse('document-signed-url', args=[document_id])).status_code == 404
        # Un lien signé obtenu avant l'archivage ne sert plus le fichier.
        assert builder.get(_path(link)).status_code == 404

    def test_the_new_instance_is_visible_as_soon_as_it_is_played(self):
        _played_instance()
        _archive()
        builder = _login(CONSTRUCTEUR)
        promoter, _archived_lot = _promoter_lot()
        set_rls_context(organization_id=promoter.id)
        lot = Lot.objects.get(organization=promoter, name='Lot A1', asset__program__demo_instance=active_demo_instance())
        _milestone, declaration_id = _declare_foundations(builder, promoter, lot)
        _evidence_id, document_id = _add_evidence(builder, declaration_id)

        assert _ids(builder, 'workdeclaration-list') == {declaration_id}
        assert _ids(builder, 'document-list') == {document_id}

    def test_a_document_not_yet_attached_stays_visible_to_its_author(self):
        _played_instance()
        _archive()
        builder = _login(CONSTRUCTEUR)
        from apps.sales.test_audit_ui_r1 import _pdf
        uploaded = builder.post(reverse('document-list'), {'file': _pdf(), 'category': 'rapport_chantier', 'source': 'mobile_app_photo'}, format='multipart')
        assert uploaded.status_code == 201, uploaded.data

        assert _ids(builder, 'document-list') == {str(uploaded.data['id'])}
