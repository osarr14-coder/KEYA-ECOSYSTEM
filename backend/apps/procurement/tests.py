from decimal import Decimal

import pytest
from django.db import connection
from django.db.utils import ProgrammingError
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.services import create_work_declaration
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot
from apps.trust.models import TrustEvent

from . import services
from .models import Devis

PASSWORD = 'strongpass123'


def _register(email, organization_name, role_code='sponsor'):
    """Même helper que `apps/inspections/tests.py` — dupliqué volontairement
    (discipline déjà assumée dans ce projet pour ce type d'utilitaire de
    test, voir CLAUDE.md, ticket 020 sur `receiveIncomingSession`).
    """
    client = APIClient()
    client.post(
        reverse('register'),
        {'email': email, 'password': PASSWORD, 'organization_name': organization_name},
        format='json',
    )
    token = client.post(reverse('login'), {'email': email, 'password': PASSWORD}, format='json').data['access']
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    user = User.objects.get(email=email)
    organization = Organization.objects.get(name=organization_name)

    set_rls_context(user_id=user.id, organization_id=organization.id)
    if role_code != 'sponsor':
        role, _ = Role.objects.get_or_create(code=role_code, defaults={'label': role_code.capitalize()})
        Membership.objects.filter(user=user, organization=organization).update(role=role)

    return client, organization, user


def _setup_constructeur_org(email, organization_name):
    """Organisation constructeur complète, avec un vrai Lot/WorkDeclaration
    à elle — même helper que `apps/inspections/tests.py`."""
    client, organization, user = _register(email, organization_name, role_code='constructeur')

    program = Program.objects.create(organization=organization, name='Programme')
    asset = Asset.objects.create(organization=organization, program=program, name='Bien')
    lot = Lot.objects.create(organization=organization, asset=asset, name='Lot')
    instantiate_milestones_for_lot(lot)
    milestone = lot.milestones.first()
    declaration = create_work_declaration(organization=organization, milestone=milestone, declared_by=user)

    return client, organization, user, lot, declaration


def _register_admin(email, organization_name):
    return _register(email, organization_name, role_code='admin_keyimmo')


def _setup_lot_up_for_bid(suffix):
    """Un lot appartenant à une organisation « sponsor », mis en
    concurrence entre deux organisations constructeurs candidates —
    scénario de base pour la plupart des tests de ce module. Retourne
    (admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a,
    candidate_b) où candidate_a/candidate_b sont des tuples
    (client, organization).
    """
    _sponsor_client, sponsor_org, _sponsor_user = _register(
        f'sponsor-{suffix}@example.com', f'Org Sponsor {suffix}',
    )
    program = Program.objects.create(organization=sponsor_org, name='Programme')
    asset = Asset.objects.create(organization=sponsor_org, program=program, name='Bien')
    lot = Lot.objects.create(organization=sponsor_org, asset=asset, name='Lot mis en concurrence')

    candidate_a_client, candidate_a_org, _ = _register(
        f'candidat-a-{suffix}@example.com', f'Org Candidat A {suffix}', role_code='constructeur',
    )
    candidate_b_client, candidate_b_org, _ = _register(
        f'candidat-b-{suffix}@example.com', f'Org Candidat B {suffix}', role_code='constructeur',
    )
    admin_client, admin_org, admin_user = _register_admin(
        f'admin-{suffix}@example.com', f'Org Admin {suffix}',
    )
    return (
        admin_client, admin_org, admin_user, sponsor_org, lot,
        (candidate_a_client, candidate_a_org), (candidate_b_client, candidate_b_org),
    )


AMOUNT_A = Decimal('123456.78')
AMOUNT_B = Decimal('987654.32')


@pytest.mark.django_db
class TestDevisCreation:
    def test_admin_keyimmo_can_create_a_devis(self):
        admin_client, admin_org, _admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('create')
        )
        _candidate_a_client, candidate_a_org = candidate_a

        response = admin_client.post(
            reverse('procurement-devis-create'),
            {
                'organization': str(sponsor_org.id), 'lot': str(lot.id),
                'candidate_organization': str(candidate_a_org.id), 'amount': str(AMOUNT_A),
            },
            format='json',
        )
        assert response.status_code == 201, response.data
        assert Decimal(response.data['amount']) == AMOUNT_A
        assert response.data['status'] == 'candidat'
        assert response.data['lot'] == lot.id
        assert response.data['candidate_organization'] == candidate_a_org.id
        # Pas de relecture directe non basculée ici (`Devis.objects.filter(...)`)
        # : le contexte RLS de connexion du process de test reste, après cet
        # appel API, celui où `create_devis` l'a restauré (l'organisation de
        # l'ADMIN) — une lecture Django ORM non basculée à cet endroit
        # échouerait silencieusement (RLS), pas parce que la ligne n'existe
        # pas. Même discipline que `apps.backoffice.tests.py::
        # test_admin_keyimmo_can_create_a_mission` (ticket 012), qui ne
        # revérifie jamais la DB directement après un appel admin de ce
        # type — seule la réponse HTTP fait foi ici.

    def test_a_constructeur_cannot_create_a_devis(self):
        admin_client, admin_org, _admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('forbidden')
        )
        candidate_a_client, candidate_a_org = candidate_a

        response = candidate_a_client.post(
            reverse('procurement-devis-create'),
            {
                'organization': str(sponsor_org.id), 'lot': str(lot.id),
                'candidate_organization': str(candidate_a_org.id), 'amount': str(AMOUNT_A),
            },
            format='json',
        )
        assert response.status_code == 403

    def test_creating_a_devis_on_an_already_locked_lot_fails_explicitly(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, candidate_b = (
            _setup_lot_up_for_bid('locked-create')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        _candidate_b_client, candidate_b_org = candidate_b

        winning_devis = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )
        services.lock_devis(
            admin=admin_user, admin_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, devis_id=winning_devis.id,
        )

        response = admin_client.post(
            reverse('procurement-devis-create'),
            {
                'organization': str(sponsor_org.id), 'lot': str(lot.id),
                'candidate_organization': str(candidate_b_org.id), 'amount': str(AMOUNT_B),
            },
            format='json',
        )
        assert response.status_code == 409

        # Vérifié via le VRAI endpoint admin de liste (bascule RLS correcte
        # incluse), pas une relecture ORM directe non basculée — même piège
        # que documenté plus haut (`test_admin_keyimmo_can_create_a_devis`).
        list_response = admin_client.get(
            reverse('procurement-admin-devis-list', args=[lot.id]),
            {'organization_id': str(sponsor_org.id)},
        )
        assert list_response.status_code == 200
        assert len(list_response.data) == 1
        assert list_response.data[0]['candidate_organization'] == candidate_a_org.id


@pytest.mark.django_db
class TestDevisLock:
    def test_admin_keyimmo_can_lock_a_devis(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('lock')
        )
        _candidate_a_client, candidate_a_org = candidate_a

        devis = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        response = admin_client.post(
            reverse('procurement-devis-lock', args=[devis.id]),
            {'organization': str(sponsor_org.id)},
            format='json',
        )
        assert response.status_code == 200, response.data
        assert response.data['status'] == services.DEVIS_LOCKED_SOURCE

        # Bascule RLS explicite pour cette relecture de vérification (le
        # TrustEvent vit sous `sponsor_org`, pas sous le contexte courant du
        # process de test après l'appel API) — même discipline que les
        # tests RLS de `apps/inspections/tests.py`.
        set_rls_context(organization_id=sponsor_org.id)
        event = TrustEvent.objects.get(
            subject_type__model='devis', subject_id=devis.id,
        )
        assert event.source == services.DEVIS_LOCKED_SOURCE
        assert event.actor_id == admin_user.id

    def test_a_constructeur_cannot_lock_a_devis(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('lock-forbidden')
        )
        candidate_a_client, candidate_a_org = candidate_a

        devis = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        response = candidate_a_client.post(
            reverse('procurement-devis-lock', args=[devis.id]),
            {'organization': str(sponsor_org.id)},
            format='json',
        )
        assert response.status_code == 403

    def test_locking_a_second_devis_on_an_already_locked_lot_fails_explicitly(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, candidate_b = (
            _setup_lot_up_for_bid('double-lock')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        _candidate_b_client, candidate_b_org = candidate_b

        devis_a = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )
        devis_b = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_b_org.id, amount=AMOUNT_B,
        )
        services.lock_devis(
            admin=admin_user, admin_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, devis_id=devis_a.id,
        )

        response = admin_client.post(
            reverse('procurement-devis-lock', args=[devis_b.id]),
            {'organization': str(sponsor_org.id)},
            format='json',
        )
        assert response.status_code == 409
        assert services.get_devis_status(
            devis_b, restore_organization_id=admin_org.id,
        ) == services.DEVIS_CANDIDATE_STATUS

    def test_devis_status_is_derived_never_stored(self):
        """Doctrine Visible Trust : aucun champ statut sur `Devis` lui-même
        — vérifié au niveau du modèle, pas seulement du comportement."""
        assert not hasattr(Devis, 'status')
        assert not hasattr(Devis, 'locked')
        field_names = {field.name for field in Devis._meta.get_fields()}
        assert 'status' not in field_names
        assert 'locked' not in field_names


@pytest.mark.django_db
class TestDevisRLS:
    """Policy à deux branches (`organization_id = current_org OR
    candidate_organization_id = current_org`), comparaison de colonne —
    même pattern qu'`InspectionMission` (ticket 012), vérifié en SQL brut,
    pas seulement via l'API (CLAUDE.md, section RLS multi-tenant).
    """

    def test_candidate_organization_can_read_its_own_devis_via_column_comparison(self):
        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('rls-select')
        )
        _candidate_a_client, candidate_a_org = candidate_a

        devis = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        # Contexte du candidat : SA PROPRE organisation active, jamais
        # celle du lot — seule la comparaison `candidate_organization_id =
        # current_org` peut rendre cette ligne visible ici.
        set_rls_context(organization_id=candidate_a_org.id)
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM procurement_devis WHERE id = %s', [str(devis.id)])
            rows = cursor.fetchall()
        assert len(rows) == 1

    def test_a_genuine_outsider_organization_cannot_read_the_devis(self):
        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('rls-outsider')
        )
        _candidate_a_client, candidate_a_org = candidate_a

        devis = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        _outsider_client, outsider_org, _outsider_user = _register(
            'devis-rls-outsider@example.com', 'Org Devis RLS Outsider',
        )
        set_rls_context(organization_id=outsider_org.id)
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM procurement_devis WHERE id = %s', [str(devis.id)])
            rows = cursor.fetchall()
        assert rows == []

    def test_a_rival_candidate_cannot_read_another_candidates_devis(self):
        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, candidate_b = (
            _setup_lot_up_for_bid('rls-rival')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        _candidate_b_client, candidate_b_org = candidate_b

        devis_a = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        set_rls_context(organization_id=candidate_b_org.id)
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM procurement_devis WHERE id = %s', [str(devis_a.id)])
            rows = cursor.fetchall()
        assert rows == []

    def test_insert_still_requires_the_target_organization_as_active_context(self):
        """L'élargissement ne touche QUE le SELECT (voir migration
        0002_devis_rls) — l'INSERT garde sa policy stricte, inchangée :
        même admin_keyimmo ne peut écrire qu'en empruntant explicitement le
        contexte de l'organisation cible (voir `create_devis`), jamais par
        un élargissement de la policy d'écriture elle-même.
        """
        import uuid

        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('rls-insert')
        )
        _candidate_a_client, candidate_a_org = candidate_a

        # Contexte de l'admin, PAS celui de l'organisation cible —
        # tentative d'insertion directe en SQL brut, contournant
        # complètement `create_devis`.
        set_rls_context(organization_id=admin_org.id)
        with pytest.raises(ProgrammingError):
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO procurement_devis
                        (id, organization_id, candidate_organization_id, lot_id, amount, logged_by_id, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, now())
                    """,
                    [
                        str(uuid.uuid4()), str(sponsor_org.id), str(candidate_a_org.id),
                        str(lot.id), str(AMOUNT_A), str(admin_user.id),
                    ],
                )


@pytest.mark.django_db
class TestMyCandidatures:
    def test_candidate_sees_only_its_own_candidatures(self):
        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, candidate_b = (
            _setup_lot_up_for_bid('mine')
        )
        candidate_a_client, candidate_a_org = candidate_a
        _candidate_b_client, candidate_b_org = candidate_b

        devis_a = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )
        services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_b_org.id, amount=AMOUNT_B,
        )

        response = candidate_a_client.get(reverse('procurement-my-candidatures'))
        assert response.status_code == 200
        ids = {row['id'] for row in response.data}
        assert ids == {str(devis_a.id)}

    def test_candidate_sees_the_locked_status_of_its_own_winning_candidature(self):
        """Preuve, côté lecture CANDIDAT (jamais basculée par construction,
        contrairement à la vue admin juste après écriture), du même bug
        réel corrigé dans `apps.procurement.services.get_devis_status` :
        sans la bascule RLS interne de cette fonction, le `TrustEvent`
        `devis_verrouille` (posé sous `organization` = celle du LOT) reste
        invisible à un candidat lisant sous SA PROPRE organisation active
        (`candidate_organization`), et le statut retombait silencieusement
        à `'candidat'` malgré un devis réellement verrouillé.
        """
        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('mine-locked')
        )
        candidate_a_client, candidate_a_org = candidate_a

        devis_a = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )
        services.lock_devis(
            admin=admin_user, admin_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, devis_id=devis_a.id,
        )

        list_response = candidate_a_client.get(reverse('procurement-my-candidatures'))
        assert list_response.status_code == 200
        assert list_response.data[0]['status'] == services.DEVIS_LOCKED_SOURCE

        detail_response = candidate_a_client.get(
            reverse('procurement-my-candidature-detail', args=[devis_a.id]),
        )
        assert detail_response.status_code == 200
        assert detail_response.data['status'] == services.DEVIS_LOCKED_SOURCE

    def test_candidate_cannot_read_a_rivals_candidature_by_id(self):
        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, candidate_b = (
            _setup_lot_up_for_bid('mine-404')
        )
        candidate_a_client, candidate_a_org = candidate_a
        _candidate_b_client, candidate_b_org = candidate_b

        devis_b = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_b_org.id, amount=AMOUNT_B,
        )

        response = candidate_a_client.get(reverse('procurement-my-candidature-detail', args=[devis_b.id]))
        assert response.status_code == 404


@pytest.mark.django_db
class TestDevisAmountNeverLeaksToConstructeurRole:
    """Cœur de ce ticket. Deux couches, voir
    `022-verrouillage-devis-mise-en-concurrence.md`, section dédiée.
    """

    def test_amount_field_and_its_value_are_absent_from_my_candidatures_list(self):
        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, candidate_b = (
            _setup_lot_up_for_bid('leak-list')
        )
        candidate_a_client, candidate_a_org = candidate_a
        _candidate_b_client, candidate_b_org = candidate_b

        services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )
        services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_b_org.id, amount=AMOUNT_B,
        )

        response = candidate_a_client.get(reverse('procurement-my-candidatures'))
        assert response.status_code == 200
        for row in response.data:
            assert 'amount' not in row
        body_text = response.content.decode()
        assert str(AMOUNT_A) not in body_text
        assert str(AMOUNT_B) not in body_text

    def test_amount_field_and_its_value_are_absent_from_my_candidature_detail(self):
        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, candidate_b = (
            _setup_lot_up_for_bid('leak-detail')
        )
        candidate_a_client, candidate_a_org = candidate_a
        _candidate_b_client, candidate_b_org = candidate_b

        devis_a = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )
        services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_b_org.id, amount=AMOUNT_B,
        )

        response = candidate_a_client.get(reverse('procurement-my-candidature-detail', args=[devis_a.id]))
        assert response.status_code == 200
        assert 'amount' not in response.data
        body_text = response.content.decode()
        assert str(AMOUNT_A) not in body_text
        assert str(AMOUNT_B) not in body_text

    def test_sweep_across_every_other_endpoint_already_accessible_to_the_constructeur_role(self):
        """Balayage large : un constructeur candidat, propriétaire d'un
        VRAI lot dans SA PROPRE organisation (comme les fixtures standard
        du reste du projet), interroge tous les endpoints GET déjà
        accessibles à ce rôle — aucun ne doit jamais contenir la valeur
        d'un montant de devis, même indirectement (aucun de ces endpoints
        n'a de lien de données avec `Devis`, ce test le PROUVE plutôt que
        de le présumer).

        Documents/preuves/réserves/messages ne sont pas exercés ici
        (fixtures supplémentaires non triviales, sans fichier réel) — hors
        de ce sous-ensemble, la couverture vient du test de liste EXACTE
        des routes ci-dessous : toute route future y ajoutée doit être
        ajoutée consciemment à CE test aussi.
        """
        (
            admin_client, admin_org, admin_user, sponsor_org, lot,
            candidate_a, _candidate_b,
        ) = _setup_lot_up_for_bid('sweep')
        candidate_a_client, candidate_a_org = candidate_a

        # Un devis existe bien (avec un montant reconnaissable) pour ce
        # lot, mis en concurrence — la valeur à ne JAMAIS retrouver.
        services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        # Le candidat a aussi ses propres données « normales » (lot,
        # programme, bien, déclaration, tâche) dans SA PROPRE organisation
        # — mêmes fixtures que le reste du projet.
        own_client, own_org, own_user, own_lot, own_declaration = _setup_constructeur_org(
            'sweep-own-constructeur@example.com', 'Org Sweep Constructeur',
        )

        forbidden_values = [str(AMOUNT_A)]

        requests = [
            ('lot-list', [], {}),
            ('lot-detail', [own_lot.id], {}),
            ('program-list', [], {}),
            ('asset-list', [], {}),
            ('workdeclaration-list', [], {}),
            ('workdeclaration-detail', [own_declaration.id], {}),
            ('build-lots', [], {}),
            ('build-exceptions', [], {}),
            ('task-list', [], {}),
            ('my-tasks', [], {}),
            ('me', [], {}),
            ('procurement-my-candidatures', [], {}),
        ]
        for name, args, _kwargs in requests:
            response = own_client.get(reverse(name, args=args))
            body_text = response.content.decode()
            for forbidden in forbidden_values:
                assert forbidden not in body_text, f'{name} a laissé fuiter un montant de devis'

    def test_all_registered_get_api_routes_match_the_documented_list(self):
        """Toute route future ajoutée n'importe où dans le projet et non
        listée ici fait échouer ce test — même famille de garde que
        `apps.backoffice.tests.py::
        test_backoffice_urls_expose_exactly_the_documented_actions`
        (ticket 011), élargie ici à TOUT le projet plutôt qu'à un seul
        module : c'est précisément ce qui permet au sweep ci-dessus de
        rester une preuve valable dans le temps plutôt qu'un instantané
        déjà périmé. Les routes admin Django (`/admin/...`, auth par
        session, pas JWT) sont hors périmètre : ce ne sont structurellement
        jamais des routes que le rôle constructeur (authentification JWT)
        peut atteindre.
        """
        from django.urls import get_resolver

        def walk(resolver, prefix=''):
            names = set()
            for pattern in resolver.url_patterns:
                if hasattr(pattern, 'url_patterns'):
                    names |= walk(pattern, prefix + str(pattern.pattern))
                elif pattern.name and not (prefix + str(pattern.pattern)).startswith('admin/'):
                    names.add(pattern.name)
            return names

        actual = walk(get_resolver())
        expected = {
            'api-root',
            'register', 'login', 'login-refresh', 'me',
            'program-list', 'program-detail', 'program-hierarchy',
            'asset-list', 'asset-detail',
            'lot-list', 'lot-detail', 'lot-assign-organization', 'lot-messages',
            'document-list', 'document-detail', 'document-download', 'document-signed-url', 'document-messages',
            'workdeclaration-list', 'workdeclaration-detail',
            'evidence-list', 'evidence-detail',
            'inspection-list', 'inspection-detail',
            'reserve-list', 'reserve-detail', 'reserve-messages',
            'reservecorrection-list', 'reservecorrection-detail',
            'task-list', 'task-detail', 'task-complete', 'my-tasks',
            'my-lots', 'my-lot-overview', 'my-lot-evidence',
            'build-lots', 'build-exceptions',
            'control-mission-list', 'control-sync-document', 'control-sync-evidence', 'control-sync-inspection',
            'backoffice-user-search', 'backoffice-user-detail', 'backoffice-user-deactivate',
            'backoffice-mission-create',
            'procurement-devis-create', 'procurement-devis-lock',
            'procurement-admin-devis-list',
            'procurement-my-candidatures', 'procurement-my-candidature-detail',
        }
        assert actual == expected
