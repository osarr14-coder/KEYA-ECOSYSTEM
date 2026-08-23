import io
import uuid

import pytest
from django.core import signing
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Membership, Organization, Role
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot
from apps.trust.models import TrustEvent, TrustLevel

from . import access
from .models import Document, DocumentVisibility, Evidence, SensitivityLevel, WorkDeclaration

PASSWORD = 'strongpass123'


def _setup_org(email, organization_name, role_code='sponsor'):
    """Enregistre un utilisateur via l'API (JWT réel — nécessaire pour que
    `OrganizationScopeMiddleware` résolve `request.organization`), crée un
    Programme→Bien→Lot→Milestone, et bascule le rôle du fondateur si
    `role_code != 'sponsor'` : l'API publique n'a pas d'endpoint
    d'invitation/changement de rôle (ticket 001, explicitement hors scope),
    on le fait donc directement en base, comme la fixture `two_orgs` du
    ticket 001.
    """
    client = APIClient()
    client.post(
        reverse('register'),
        {'email': email, 'password': PASSWORD, 'organization_name': organization_name},
        format='json',
    )
    token = client.post(
        reverse('login'), {'email': email, 'password': PASSWORD}, format='json',
    ).data['access']
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    user = User.objects.get(email=email)
    organization = Organization.objects.get(name=organization_name)

    set_rls_context(user_id=user.id, organization_id=organization.id)
    if role_code != 'sponsor':
        role, _ = Role.objects.get_or_create(code=role_code, defaults={'label': role_code.capitalize()})
        Membership.objects.filter(user=user, organization=organization).update(role=role)

    program = Program.objects.create(organization=organization, name='Programme')
    asset = Asset.objects.create(organization=organization, program=program, name='Bien')
    lot = Lot.objects.create(organization=organization, asset=asset, name='Lot')
    instantiate_milestones_for_lot(lot)
    milestone = lot.milestones.first()

    return client, organization, user, milestone


def _make_image_file(name='photo.jpg', color=(255, 0, 0)):
    buffer = io.BytesIO()
    Image.new('RGB', (20, 20), color).save(buffer, format='JPEG')
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type='image/jpeg')


def _upload_document(client, *, sensitivity_level=SensitivityLevel.INTERNE, source='mobile_app_photo',
                      captured_at=None, upload_file=None):
    upload_file = upload_file or _make_image_file()
    payload = {
        'file': upload_file, 'category': 'photo_chantier', 'source': source,
        'sensitivity_level': sensitivity_level,
    }
    if captured_at:
        payload['captured_at'] = captured_at
    return client.post(reverse('document-list'), payload, format='multipart')


def _add_org_member(organization, email, role_code):
    """Ajoute un membre à une organisation existante et renvoie un client
    authentifié pour lui — direct en base (pas d'endpoint d'invitation,
    ticket 001 hors scope), comme `_setup_org`.
    """
    user = User.objects.create_user(email=email, password=PASSWORD)
    role, _ = Role.objects.get_or_create(code=role_code, defaults={'label': role_code.capitalize()})
    set_rls_context(user_id=user.id, organization_id=organization.id)
    Membership.objects.create(user=user, organization=organization, role=role)

    client = APIClient()
    token = client.post(reverse('login'), {'email': email, 'password': PASSWORD}, format='json').data['access']
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
    return client, user


@pytest.mark.django_db
class TestDocumentSignedAccess:
    """Ticket 004 — critère d'acceptation : un document classifié
    `sensitivity_level = confidentiel` ou plus n'est jamais accessible via
    une URL non signée ou sans vérification de permission. La protection
    URL signée + authentification + organisation ci-dessous s'applique à
    tous les documents ; `TestSensitivityLevelDrivesAccess` plus bas prouve
    que `sensitivity_level` conditionne en plus une différence de
    comportement réelle, pas seulement un champ affiché.
    """

    def test_signed_url_then_download_succeeds_for_org_member(self):
        client, _organization, _user, _milestone = _setup_org(
            'docaccess-owner@example.com', 'Org Doc Access',
        )
        document_id = _upload_document(client, sensitivity_level=SensitivityLevel.CONFIDENTIEL).data['id']

        signed = client.get(reverse('document-signed-url', args=[document_id]))
        assert signed.status_code == 200
        assert 'url' in signed.data

        download = client.get(signed.data['url'])
        assert download.status_code == 200
        content = b''.join(download.streaming_content)
        assert len(content) > 0
        assert download['Content-Disposition'].startswith('attachment')

    def test_download_requires_authentication(self):
        client, _organization, _user, _milestone = _setup_org(
            'docaccess-anon@example.com', 'Org Doc Access Anon',
        )
        document_id = _upload_document(client, sensitivity_level=SensitivityLevel.CONFIDENTIEL).data['id']
        signed_url = client.get(reverse('document-signed-url', args=[document_id])).data['url']

        anonymous_client = APIClient()
        response = anonymous_client.get(signed_url)

        assert response.status_code == 401

    def test_download_with_tampered_token_is_rejected(self):
        client, _organization, _user, _milestone = _setup_org(
            'docaccess-tamper@example.com', 'Org Doc Access Tamper',
        )
        _upload_document(client, sensitivity_level=SensitivityLevel.CONFIDENTIEL)

        response = client.get(reverse('document-download', args=['not-a-real-token']))

        assert response.status_code == 404

    def test_download_with_expired_token_is_rejected(self):
        token = access.generate_download_token(uuid.uuid4())
        with pytest.raises(signing.SignatureExpired):
            access.verify_download_token(token, max_age_seconds=-1)

    def test_download_rejected_for_authenticated_user_of_another_organization(self):
        client_a, _organization_a, _user_a, _milestone_a = _setup_org(
            'docaccess-a@example.com', 'Org Doc Access A',
        )
        document_id = _upload_document(client_a, sensitivity_level=SensitivityLevel.CONFIDENTIEL).data['id']
        # Le token est valide (signature correcte) — on simule une fuite du
        # lien vers quelqu'un d'une autre organisation, pour prouver que
        # c'est bien la revérification de permission au téléchargement qui
        # bloque, pas seulement la signature.
        token = access.generate_download_token(document_id)

        client_b, _organization_b, _user_b, _milestone_b = _setup_org(
            'docaccess-b@example.com', 'Org Doc Access B',
        )
        response = client_b.get(reverse('document-download', args=[token]))

        assert response.status_code == 404

    def test_no_unsigned_route_serves_the_raw_media_directory(self):
        client, _organization, _user, _milestone = _setup_org(
            'docaccess-unsigned@example.com', 'Org Doc Access Unsigned',
        )
        document = _upload_document(client, sensitivity_level=SensitivityLevel.CONFIDENTIEL)
        file_name = Document.objects.get(id=document.data['id']).file.name

        response = client.get(f'/media/{file_name}')

        assert response.status_code == 404


@pytest.mark.django_db
class TestSensitivityLevelDrivesAccess:
    """`sensitivity_level` doit réellement conditionner l'accès, pas juste
    être affiché — un document confidentiel doit se comporter différemment
    d'un document interne pour le même utilisateur, pas seulement être
    protégé par la même URL signée que tout le reste.
    """

    def test_confidential_document_is_not_accessible_to_an_ordinary_org_member(self):
        owner_client, organization, _owner_user, _milestone = _setup_org(
            'confid-owner@example.com', 'Org Confid Owner',
        )
        document_id = _upload_document(
            owner_client, sensitivity_level=SensitivityLevel.CONFIDENTIEL,
        ).data['id']

        other_client, _other_user = _add_org_member(organization, 'confid-other@example.com', 'client')

        response = other_client.get(reverse('document-signed-url', args=[document_id]))

        assert response.status_code == 403

    def test_confidential_document_is_accessible_to_admin_keyimmo_role(self):
        owner_client, organization, _owner_user, _milestone = _setup_org(
            'confid-owner2@example.com', 'Org Confid Owner 2',
        )
        document_id = _upload_document(
            owner_client, sensitivity_level=SensitivityLevel.CONFIDENTIEL,
        ).data['id']

        admin_client, _admin_user = _add_org_member(organization, 'confid-admin@example.com', 'admin_keyimmo')

        response = admin_client.get(reverse('document-signed-url', args=[document_id]))

        assert response.status_code == 200

    def test_confidential_document_is_accessible_to_its_owner(self):
        owner_client, _organization, _owner_user, _milestone = _setup_org(
            'confid-owner3@example.com', 'Org Confid Owner 3',
        )
        document_id = _upload_document(
            owner_client, sensitivity_level=SensitivityLevel.CONFIDENTIEL,
        ).data['id']

        response = owner_client.get(reverse('document-signed-url', args=[document_id]))

        assert response.status_code == 200

    def test_non_confidential_document_is_accessible_to_any_org_member(self):
        owner_client, organization, _owner_user, _milestone = _setup_org(
            'nonconfid-owner@example.com', 'Org Non Confid Owner',
        )
        document_id = _upload_document(
            owner_client, sensitivity_level=SensitivityLevel.INTERNE,
        ).data['id']

        other_client, _other_user = _add_org_member(organization, 'nonconfid-other@example.com', 'client')

        response = other_client.get(reverse('document-signed-url', args=[document_id]))

        assert response.status_code == 200

    def test_confidential_document_download_is_rejected_for_ordinary_member_even_with_valid_token(self):
        owner_client, organization, _owner_user, _milestone = _setup_org(
            'confid-dl-owner@example.com', 'Org Confid Download Owner',
        )
        document_id = _upload_document(
            owner_client, sensitivity_level=SensitivityLevel.CONFIDENTIEL,
        ).data['id']
        token = access.generate_download_token(document_id)

        other_client, _other_user = _add_org_member(organization, 'confid-dl-other@example.com', 'client')

        response = other_client.get(reverse('document-download', args=[token]))

        assert response.status_code == 404


@pytest.mark.django_db
class TestWorkDeclarationAndEvidenceTrustEvents:
    """Ticket 004 — critère d'acceptation : la déclaration d'un travail et
    l'ajout d'une preuve créent chacun un TrustEvent distinct, jamais un
    seul événement fusionné.
    """

    def test_declaration_creates_a_single_declare_trust_event(self):
        client, _organization, user, milestone = _setup_org(
            'trustflow-declare@example.com', 'Org Trust Flow Declare', role_code='constructeur',
        )

        response = client.post(
            reverse('workdeclaration-list'), {'milestone': str(milestone.id), 'note': 'Fondations coulées'},
            format='json',
        )

        assert response.status_code == 201
        declaration_id = response.data['id']
        events = TrustEvent.objects.filter(subject_id=declaration_id)
        assert events.count() == 1
        assert events.first().level == TrustLevel.DECLARE
        assert events.first().actor_id == user.id

    def test_declaration_and_evidence_create_two_distinct_trust_events(self):
        client, _organization, _user, milestone = _setup_org(
            'trustflow-evidence@example.com', 'Org Trust Flow Evidence', role_code='constructeur',
        )
        declaration_id = client.post(
            reverse('workdeclaration-list'), {'milestone': str(milestone.id)}, format='json',
        ).data['id']
        document_id = _upload_document(client).data['id']

        response = client.post(
            reverse('evidence-list'),
            {'work_declaration': declaration_id, 'documents': [document_id]},
            format='json',
        )

        assert response.status_code == 201
        evidence_id = response.data['id']

        declaration_events = TrustEvent.objects.filter(subject_id=declaration_id)
        evidence_events = TrustEvent.objects.filter(subject_id=evidence_id)
        assert declaration_events.count() == 1
        assert evidence_events.count() == 1
        assert declaration_events.first().id != evidence_events.first().id
        assert evidence_events.first().level == TrustLevel.DOCUMENTE
        assert declaration_events.first().level == TrustLevel.DECLARE

    def test_only_constructeur_role_can_declare_work(self):
        client, _organization, _user, milestone = _setup_org(
            'trustflow-wrongrole@example.com', 'Org Trust Flow Wrong Role', role_code='sponsor',
        )

        response = client.post(
            reverse('workdeclaration-list'), {'milestone': str(milestone.id)}, format='json',
        )

        assert response.status_code == 403


@pytest.mark.django_db
class TestPhotoProvenanceSurvivesAsyncProcessing:
    """Ticket 004 — critère d'acceptation : une photo prise puis uploadée
    reste associée à sa provenance complète (source, date, auteur) même
    après compression/traitement asynchrone.

    `CELERY_TASK_ALWAYS_EAGER=True` (voir config/settings.py) : le
    traitement a déjà tourné, en synchrone, au moment où la réponse HTTP de
    l'upload revient.
    """

    def test_provenance_is_unchanged_and_thumbnail_is_generated(self):
        client, _organization, user, _milestone = _setup_org(
            'provenance@example.com', 'Org Provenance',
        )
        captured_at = '2026-08-10T09:30:00Z'

        response = _upload_document(client, source='mobile_app_photo', captured_at=captured_at)
        assert response.status_code == 201

        document = Document.objects.get(id=response.data['id'])
        assert document.source == 'mobile_app_photo'
        assert document.captured_at.isoformat() == '2026-08-10T09:30:00+00:00'
        assert document.owner_id == user.id
        assert len(document.hash) == 64  # sha256 hex
        assert document.thumbnail.name, 'la tâche async aurait dû générer une miniature'

    def test_non_image_document_is_not_processed_but_upload_still_succeeds(self):
        client, _organization, _user, _milestone = _setup_org(
            'provenance-nonimage@example.com', 'Org Provenance Non Image',
        )
        text_file = SimpleUploadedFile('rapport.txt', b'contenu texte', content_type='text/plain')

        response = _upload_document(client, source='document_upload', upload_file=text_file)

        assert response.status_code == 201
        document = Document.objects.get(id=response.data['id'])
        assert not document.thumbnail


@pytest.mark.django_db
class TestEvidenceAppIsOrganizationScoped:
    """Couverture RLS pour Document/WorkDeclaration/Evidence, suivant le
    pattern déjà appliqué à Program/Asset/Lot (ticket 002) et TrustEvent
    (ticket 003) : chaque table a sa propre policy, chacune doit être
    prouvée séparément.
    """

    def _setup_two_orgs_with_full_chain(self):
        client_a, _organization_a, _user_a, milestone_a = _setup_org(
            'scoped-a@example.com', 'Org Scoped A', role_code='constructeur',
        )
        document_a = _upload_document(client_a).data['id']
        declaration_a = client_a.post(
            reverse('workdeclaration-list'), {'milestone': str(milestone_a.id)}, format='json',
        ).data['id']
        evidence_a = client_a.post(
            reverse('evidence-list'),
            {'work_declaration': declaration_a, 'documents': [document_a]},
            format='json',
        ).data['id']

        client_b, _organization_b, _user_b, _milestone_b = _setup_org(
            'scoped-b@example.com', 'Org Scoped B',
        )
        return client_b, document_a, declaration_a, evidence_a

    def test_document_of_another_organization_is_not_visible(self):
        client_b, document_a, _declaration_a, _evidence_a = self._setup_two_orgs_with_full_chain()
        response = client_b.get(reverse('document-detail', args=[document_a]))
        assert response.status_code == 404

    def test_work_declaration_of_another_organization_is_not_visible(self):
        client_b, _document_a, declaration_a, _evidence_a = self._setup_two_orgs_with_full_chain()
        response = client_b.get(reverse('workdeclaration-detail', args=[declaration_a]))
        assert response.status_code == 404

    def test_evidence_of_another_organization_is_not_visible(self):
        client_b, _document_a, _declaration_a, evidence_a = self._setup_two_orgs_with_full_chain()
        response = client_b.get(reverse('evidence-detail', args=[evidence_a]))
        assert response.status_code == 404


def _identical_files(count, name='photo.jpg'):
    """`count` fichiers distincts (objets `SimpleUploadedFile` séparés,
    consommables chacun une seule fois par un upload) mais au même contenu
    binaire — pour tester la détection de doublon (ticket B-040), qui
    compare `Document.hash`, jamais l'identité d'objet Python.
    """
    buffer = io.BytesIO()
    Image.new('RGB', (20, 20), (10, 20, 30)).save(buffer, format='JPEG')
    raw_bytes = buffer.getvalue()
    return [SimpleUploadedFile(name, raw_bytes, content_type='image/jpeg') for _ in range(count)]


@pytest.mark.django_db
class TestDuplicateDocumentDetection:
    """Ticket B-040 — un doublon exact (même hash) n'est jamais bloqué à
    l'upload (doctrine Visible Trust : ne jamais rien cacher), seulement
    signalé via `Document.duplicate_of`.
    """

    def test_first_upload_of_unique_content_has_no_duplicate_of(self):
        client, _organization, _user, _milestone = _setup_org('dup-a@example.com', 'Org Dup A')
        response = _upload_document(client)
        assert response.status_code == 201
        assert response.data['duplicate_of'] is None

    def test_second_upload_of_identical_content_points_to_the_first(self):
        client, _organization, _user, _milestone = _setup_org('dup-b@example.com', 'Org Dup B')
        first_file, second_file = _identical_files(2)

        first_response = _upload_document(client, upload_file=first_file)
        second_response = _upload_document(client, upload_file=second_file)

        assert second_response.status_code == 201
        assert str(second_response.data['duplicate_of']) == first_response.data['id']

    def test_third_upload_of_identical_content_points_to_the_first_not_the_second(self):
        client, _organization, _user, _milestone = _setup_org('dup-c@example.com', 'Org Dup C')
        first_file, second_file, third_file = _identical_files(3)

        first_response = _upload_document(client, upload_file=first_file)
        _upload_document(client, upload_file=second_file)
        third_response = _upload_document(client, upload_file=third_file)

        assert third_response.status_code == 201
        assert str(third_response.data['duplicate_of']) == first_response.data['id']

    def test_identical_content_in_a_different_organization_is_not_flagged_as_duplicate(self):
        client_a, _organization_a, _user_a, _milestone_a = _setup_org('dup-d-a@example.com', 'Org Dup D A')
        client_b, _organization_b, _user_b, _milestone_b = _setup_org('dup-d-b@example.com', 'Org Dup D B')
        file_a, file_b = _identical_files(2)

        _upload_document(client_a, upload_file=file_a)
        response_b = _upload_document(client_b, upload_file=file_b)

        assert response_b.status_code == 201
        assert response_b.data['duplicate_of'] is None
