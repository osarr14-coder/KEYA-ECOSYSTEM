from decimal import ROUND_HALF_UP, Decimal
from unittest import mock

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.utils import ProgrammingError
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.services import create_work_declaration
from apps.organizations.models import CountryPack, Membership, Organization, Role
from apps.pricing.models import ControlOfficeCalculationMode, PricingCanal
from apps.pricing import services as pricing_services
from apps.pricing.services import GLOBAL_CONTROL_OFFICE_JALON_TYPE
from apps.programs import services as programs_services
from apps.programs.models import Asset, Lot, Program, ProgramCostRepartitionMethod
from apps.programs.services import instantiate_milestones_for_lot
from apps.tasks.models import Task, TaskStatus, TaskType
from apps.tasks.services import DEVIS_AJUSTEMENT_REFUSE_SOURCE, LOT_LEDGER_MARGIN_NEGATIVE_SOURCE
from apps.trust.models import TrustEvent

from . import services
from .models import Devis, DevisAjustement, LotBcCharge, LotLedger

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


def _setup_lot_up_for_bid(suffix, seed_pricing=True):
    """Un lot appartenant à une organisation « sponsor », mis en
    concurrence entre deux organisations constructeurs candidates —
    scénario de base pour la plupart des tests de ce module. Retourne
    (admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a,
    candidate_b) où candidate_a/candidate_b sont des tuples
    (client, organization).

    Ticket 026 : seed par défaut un `PricingConfig` `canal_1_marge` actif
    (`PRICING_RATE_PERCENT`) pour le `country_pack` du sponsor — sans quoi
    TOUT `create_devis` échouerait désormais (`NoPricingConfigError`,
    marge_estimee n'est plus un input, ticket 026). `seed_pricing=False`
    pour les tests qui vérifient explicitement ce cas de blocage.
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

    if seed_pricing:
        pricing_services.create_pricing_config(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            canal=PricingCanal.CANAL_1_MARGE, rate=PRICING_RATE_PERCENT,
        )

    return (
        admin_client, admin_org, admin_user, sponsor_org, lot,
        (candidate_a_client, candidate_a_org), (candidate_b_client, candidate_b_org),
    )


def _create_sponsor_org_with_lot(suffix, lot_name):
    """Organisation sponsor avec un seul Lot, SANS passer par l'API de
    registration (pas d'utilisateur nécessaire pour ces tests de
    recherche B-028) — beaucoup plus rapide que `_register`/`_setup_lot_
    up_for_bid` (pas de hachage de mot de passe) quand le test crée un
    grand nombre d'organisations (ex. `TestAdminLotSearch::
    test_more_than_max_search_results_matches_are_capped`).
    `organizations_organization` n'a aucune RLS (recherche libre) : la
    création de l'`Organization` elle-même ne nécessite aucune bascule.
    `programs_program`/`programs_asset`/`programs_lot`, eux, exigent une
    bascule RLS AVANT toute écriture (policy `organization_id =
    current_org`, `FOR ALL`, migration `0002_programs_rls.py`).
    """
    senegal = CountryPack.objects.get(code='SN')
    organization = Organization.objects.create(name=f'Org Sponsor Bare {suffix}', country_pack=senegal)
    set_rls_context(organization_id=organization.id)
    program = Program.objects.create(organization=organization, name=f'Programme {suffix}')
    asset = Asset.objects.create(organization=organization, program=program, name=f'Bien {suffix}')
    lot = Lot.objects.create(organization=organization, asset=asset, name=lot_name)
    return organization, program, asset, lot


AMOUNT_A = Decimal('123456.78')
AMOUNT_B = Decimal('987654.32')

# Ticket 026 : marge_estimee n'est plus un input — dérivé exclusivement de
# amount × (PricingConfig.rate / 100) (voir services.py::
# _derive_marge_estimee). `PRICING_RATE_PERCENT` est le taux (POURCENTAGE,
# jamais un montant) seedé par défaut dans `_setup_lot_up_for_bid`, PARTAGÉ
# par tous les devis d'un même country_pack — remplace les deux anciennes
# constantes de marge individuelle du ticket 023 (retirées, plus aucun
# test ne passe de marge_estimee directement).
PRICING_RATE_PERCENT = Decimal('10.00')  # 10 %


def _expected_marge(amount, rate_percent=PRICING_RATE_PERCENT):
    """Même formule que `services._derive_marge_estimee` — dupliquée ici
    volontairement pour les assertions qui n'ont pas besoin d'un montant
    « rond » (ex. relecture après création avec `AMOUNT_A`) : la
    correction de la FORMULE elle-même est prouvée indépendamment par
    `TestDevisAjustementBoundaryCase`/`TestDevisAjustementCumulativeSigned`
    ci-dessous, construits pour tomber sur des nombres ronds sans dépendre
    de cette fonction.
    """
    return (amount * rate_percent / Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


# Choisis pour que `BOUNDARY_TEST_AMOUNT × (PRICING_RATE_PERCENT / 100)`
# tombe EXACTEMENT sur un nombre rond (10000.00) — préserve l'arithmétique
# de cas limite déjà écrite pour ce ticket au 023 (+50000, -1000, +0.01,
# etc.) sans avoir à la réécrire pour chaque test.
BOUNDARY_TEST_AMOUNT = Decimal('100000.00')
EXPECTED_MARGE_FOR_BOUNDARY_TESTS = Decimal('10000.00')


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
        assert Decimal(response.data['marge_estimee']) == _expected_marge(AMOUNT_A)
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
class TestDevisAdminSerializerNames:
    """`lot_detail`/`candidate_organization_detail` — ticket B-029, ajout
    ADDITIF à `DevisAdminSerializer` (décision A), sur les 3 endpoints
    existants qui l'utilisent.
    """

    def test_devis_create_response_includes_lot_detail_and_candidate_organization_detail(self):
        admin_client, _admin_org, _admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('names-create')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        program = lot.asset.program

        response = admin_client.post(
            reverse('procurement-devis-create'),
            {
                'organization': str(sponsor_org.id), 'lot': str(lot.id),
                'candidate_organization': str(candidate_a_org.id), 'amount': str(AMOUNT_A),
            },
            format='json',
        )
        assert response.status_code == 201, response.data

        # Champs UUID bruts existants : PRÉSENTS et INCHANGÉS (décision A).
        assert response.data['lot'] == lot.id
        assert response.data['organization'] == sponsor_org.id
        assert response.data['candidate_organization'] == candidate_a_org.id

        assert response.data['lot_detail'] == {
            'id': str(lot.id), 'name': lot.name,
            'organization': {'id': str(sponsor_org.id), 'name': sponsor_org.name},
            'program': {'id': str(program.id), 'name': program.name},
        }
        assert response.data['candidate_organization_detail'] == {
            'id': str(candidate_a_org.id), 'name': candidate_a_org.name,
        }

    def test_devis_lock_response_includes_lot_detail_and_candidate_organization_detail(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('names-lock')
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
        assert response.data['lot_detail']['id'] == str(lot.id)
        assert response.data['lot_detail']['organization']['id'] == str(sponsor_org.id)
        assert response.data['candidate_organization_detail']['id'] == str(candidate_a_org.id)

    def test_devis_admin_list_response_includes_lot_detail_and_candidate_organization_detail_for_every_row(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, candidate_b = (
            _setup_lot_up_for_bid('names-list')
        )
        _candidate_a_client, candidate_a_org = candidate_a
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

        response = admin_client.get(
            reverse('procurement-admin-devis-list', args=[lot.id]),
            {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 200
        assert len(response.data) == 2
        for row in response.data:
            assert row['lot_detail']['id'] == str(lot.id)
            assert row['lot_detail']['organization']['id'] == str(sponsor_org.id)
        candidate_ids = {row['candidate_organization_detail']['id'] for row in response.data}
        assert candidate_ids == {str(candidate_a_org.id), str(candidate_b_org.id)}

    def test_no_organization_detail_field_exists_lot_detail_organization_suffices(self):
        """Décision C : pas de champ `organization_detail` séparé —
        `Devis.organization` vaut toujours l'organisation du lot, déjà
        exposée via `lot_detail['organization']`.
        """
        admin_client, _admin_org, _admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('names-no-org-detail')
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
        assert 'organization_detail' not in response.data
        assert response.data['lot_detail']['organization'] == {'id': str(sponsor_org.id), 'name': sponsor_org.name}


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

    def test_candidate_sees_the_locked_status_only_after_a_successful_reconciliation(self):
        """Ticket 022 → ticket 023 : preuve en DEUX temps, côté lecture
        CANDIDAT (jamais basculée par construction, contrairement à la vue
        admin juste après écriture).

        **Temps 1 (bug historique du ticket 022, désormais corrigé)** :
        verrouiller un devis SEUL ne suffit plus à le montrer « gagnant »
        au candidat — `get_candidate_visible_devis_status` (ticket 023)
        gate ce statut derrière au moins une réconciliation réussie. Sans
        cette correction, le candidat aurait vu `'devis_verrouille'` ICI,
        avant même qu'aucune marge n'ait été vérifiée.

        **Temps 2** : une fois un `DevisAjustement` accepté, le statut
        `'devis_verrouille'` apparaît enfin — preuve que le gating n'est
        pas juste une désactivation permanente, mais bien conditionné à la
        réconciliation.
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

        # Temps 1 : verrouillé, mais AUCUNE réconciliation encore — le
        # candidat ne doit PAS encore voir « gagnant ».
        list_response = candidate_a_client.get(reverse('procurement-my-candidatures'))
        assert list_response.status_code == 200
        assert list_response.data[0]['status'] == services.DEVIS_CANDIDATE_STATUS

        detail_response = candidate_a_client.get(
            reverse('procurement-my-candidature-detail', args=[devis_a.id]),
        )
        assert detail_response.status_code == 200
        assert detail_response.data['status'] == services.DEVIS_CANDIDATE_STATUS

        # Temps 2 : une réconciliation réussit — le statut « gagnant »
        # devient enfin visible au candidat.
        services.create_ajustement(
            admin=admin_user, admin_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, devis_id=devis_a.id,
            ecart=Decimal('0'),
        )

        list_response_after = candidate_a_client.get(reverse('procurement-my-candidatures'))
        assert list_response_after.data[0]['status'] == services.DEVIS_LOCKED_SOURCE

        detail_response_after = candidate_a_client.get(
            reverse('procurement-my-candidature-detail', args=[devis_a.id]),
        )
        assert detail_response_after.data['status'] == services.DEVIS_LOCKED_SOURCE

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

    def test_lot_detail_and_candidate_organization_detail_are_absent_from_candidate_responses(self):
        """Décision D (ticket B-029) : prouvé explicitement, pas seulement
        présumé de l'absence d'héritage entre `DevisCandidateSerializer`
        et `DevisAdminSerializer` — même discipline que le reste de cette
        classe de test (montants).
        """
        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('names-leak')
        )
        candidate_a_client, candidate_a_org = candidate_a

        devis_a = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        list_response = candidate_a_client.get(reverse('procurement-my-candidatures'))
        assert list_response.status_code == 200
        for row in list_response.data:
            assert 'lot_detail' not in row
            assert 'candidate_organization_detail' not in row

        detail_response = candidate_a_client.get(
            reverse('procurement-my-candidature-detail', args=[devis_a.id]),
        )
        assert detail_response.status_code == 200
        assert 'lot_detail' not in detail_response.data
        assert 'candidate_organization_detail' not in detail_response.data

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
            # Ticket 023 — ajout conscient : `DevisAjustementView` (POST/GET
            # sur la même URL) n'est accessible qu'à admin_keyimmo, jamais au
            # rôle constructeur (aucune lecture candidate, décision de
            # conception point C) — le test de garde a fait exactement son
            # travail en forçant cette mise à jour explicite.
            'procurement-devis-ajustement',
            # Ticket 025 — ajout conscient : `apps/pricing`, entièrement
            # réservé à admin_keyimmo (aucune lecture constructeur, décision
            # de conception point B) — nouveau module sans lien de données
            # avec `Devis`, mais le test de garde reste volontairement
            # PROJET ENTIER pour continuer à forcer une décision consciente
            # sur toute route future, où qu'elle apparaisse.
            'pricing-config-create', 'pricing-config-current', 'pricing-config-history',
            # Ticket B-027 — ajout conscient : `LegalPaymentTierTemplate`,
            # également entièrement réservé à admin_keyimmo (même décision
            # de conception que `PricingConfig`, ticket 025, point B) —
            # aucune lecture candidate/constructeur sur aucune de ces 4
            # routes.
            'legal-payment-tier-template-create', 'legal-payment-tier-template-activate',
            'legal-payment-tier-template-active', 'legal-payment-tier-template-history',
            # Ticket B-028 — ajout conscient : recherche de Lot/Organisation
            # pour `admin_keyimmo`, en préparation de
            # `POST /api/procurement/devis/` (jamais accessible au rôle
            # constructeur, mêmes principes que toutes les autres routes
            # admin de ce module).
            'procurement-admin-lot-search', 'procurement-admin-organization-search',
            # Ticket B-030 — ajout conscient : `apps/organizations` gagne
            # sa première route (`apps/organizations/urls.py` n'existait
            # pas avant ce ticket), réservée à `admin_keyimmo`, jamais
            # accessible au rôle constructeur.
            'country-pack-list',
            # Ticket B-033 — ajout conscient : coûts programme (foncier/BE)
            # et répartition entre lots, réservé à `admin_keyimmo`, jamais
            # accessible au rôle constructeur/sponsor.
            'program-cost-create', 'program-cost-current',
            'program-cost-history', 'program-cost-repartition',
            # Ticket B-034 — ajout conscient : barème sectoriel du bureau de
            # contrôle, réservé à `admin_keyimmo`, jamais accessible au rôle
            # constructeur/sponsor.
            'control-office-rate-create', 'control-office-rate-current', 'control-office-rate-history',
            # Ticket B-035 — ajout conscient : grand-livre de coûts par lot
            # (canal 1), première partie, réservé à `admin_keyimmo`, jamais
            # accessible au rôle constructeur/sponsor.
            'lot-ledger-create', 'lot-ledger-detail', 'lot-ledger-margin',
            # Ticket B-036 — ajout conscient : charges bureau de contrôle
            # (canal 1), second sous-ticket, réservé à `admin_keyimmo`,
            # jamais accessible au rôle constructeur/sponsor.
            'lot-bc-charge-list',
            # Ticket B-037 — ajout conscient : recherche des lots éligibles
            # à la création d'un LotLedger, réservé à `admin_keyimmo`,
            # jamais accessible au rôle constructeur/sponsor.
            'procurement-admin-lot-eligible-for-ledger-search',
        }
        assert actual == expected


def _create_and_lock_devis(*, admin_user, admin_org, sponsor_org, lot, candidate_org, amount):
    """Helper local ticket 023 : un devis créé PUIS verrouillé, prêt à
    recevoir un ajustement — factorise la mise en place répétée dans
    presque tous les tests de ce module. `marge_estimee` n'est plus un
    paramètre depuis le ticket 026 : dérivé de `amount × (PRICING_RATE_PERCENT
    / 100)`, le `PricingConfig` seedé par `_setup_lot_up_for_bid`.
    """
    devis = services.create_devis(
        logged_by=admin_user, logged_by_organization_id=admin_org.id,
        target_organization_id=sponsor_org.id, lot_id=lot.id,
        candidate_organization_id=candidate_org.id, amount=amount,
    )
    services.lock_devis(
        admin=admin_user, admin_organization_id=admin_org.id,
        target_organization_id=sponsor_org.id, devis_id=devis.id,
    )
    return devis


@pytest.mark.django_db
class TestDevisAjustementBoundaryCase:
    """Cœur du ticket 023, demandé explicitement comme cas limite EXACT,
    pas seulement un cas grossièrement au-dessus — chaque test utilise des
    `Decimal` exacts, jamais une comparaison flottante approximative.
    """

    def test_ecart_exactly_equal_to_available_margin_is_accepted_with_zero_resulting_margin(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('boundary-exact')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=BOUNDARY_TEST_AMOUNT,
        )

        response = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': str(EXPECTED_MARGE_FOR_BOUNDARY_TESTS)},
            format='json',
        )
        assert response.status_code == 201, response.data
        assert response.data['marge_resultante'] == Decimal('0')

    def test_ecart_one_cent_above_available_margin_is_rejected(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('boundary-over')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=BOUNDARY_TEST_AMOUNT,
        )
        one_cent_over = EXPECTED_MARGE_FOR_BOUNDARY_TESTS + Decimal('0.01')

        response = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': str(one_cent_over)},
            format='json',
        )
        assert response.status_code == 409
        assert not DevisAjustement.objects.filter(devis=devis).exists()

    def test_ecart_below_available_margin_is_accepted_with_positive_resulting_margin(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('boundary-under')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=BOUNDARY_TEST_AMOUNT,
        )
        below = EXPECTED_MARGE_FOR_BOUNDARY_TESTS - Decimal('1000.00')

        response = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': str(below)},
            format='json',
        )
        assert response.status_code == 201, response.data
        assert response.data['marge_resultante'] == Decimal('1000.00')

    def test_ecart_far_above_available_margin_is_rejected(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('boundary-far-over')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=BOUNDARY_TEST_AMOUNT,
        )
        way_over = EXPECTED_MARGE_FOR_BOUNDARY_TESTS + Decimal('50000.00')

        response = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': str(way_over)},
            format='json',
        )
        assert response.status_code == 409
        assert not DevisAjustement.objects.filter(devis=devis).exists()


@pytest.mark.django_db
class TestDevisAjustementCumulativeSigned:
    def test_favorable_adjustment_then_unfavorable_adjustment_uses_the_running_margin(self):
        """Point A du ticket : un écart favorable (négatif, économie)
        accepté AUGMENTE la marge disponible pour l'ajustement suivant — un
        écart défavorable qui aurait été refusé contre `marge_estimee`
        SEULE doit passer une fois l'économie précédente prise en compte.
        Preuve d'un calcul signé correct, pas une somme de valeurs absolues.
        """
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('cumulative-signed')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=BOUNDARY_TEST_AMOUNT,
        )

        # 1) Écart FAVORABLE (économie) : -2000. Marge disponible AVANT =
        # EXPECTED_MARGE_FOR_BOUNDARY_TESTS (10000). -2000 <= 10000, accepté. Marge résultante =
        # 10000 - (-2000) = 12000.
        favorable = Decimal('-2000.00')
        response_1 = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': str(favorable)},
            format='json',
        )
        assert response_1.status_code == 201, response_1.data
        assert response_1.data['marge_resultante'] == Decimal('12000.00')

        # 2) Écart DÉFAVORABLE : 11000. Contre `marge_estimee` SEULE
        # (10000), cet écart aurait été REFUSÉ (11000 > 10000). Contre la
        # marge disponible RÉELLE après l'économie précédente (12000),
        # il doit être ACCEPTÉ (11000 <= 12000) — c'est précisément ce
        # qu'un calcul qui ignorerait le signe raterait.
        defavorable = Decimal('11000.00')
        response_2 = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': str(defavorable)},
            format='json',
        )
        assert response_2.status_code == 201, response_2.data
        assert response_2.data['marge_resultante'] == Decimal('1000.00')


@pytest.mark.django_db
class TestDevisAjustementRequiresLockedDevis:
    def test_ajustement_on_a_devis_not_yet_locked_is_rejected(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('not-locked')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        response = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': '100.00'},
            format='json',
        )
        assert response.status_code == 409
        assert not DevisAjustement.objects.filter(devis=devis).exists()


@pytest.mark.django_db
class TestDevisAjustementPermissions:
    def test_a_constructeur_cannot_create_an_ajustement(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('ajustement-forbidden')
        )
        candidate_a_client, candidate_a_org = candidate_a
        devis = _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=AMOUNT_A,
        )

        response = candidate_a_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': '100.00'},
            format='json',
        )
        assert response.status_code == 403


@pytest.mark.django_db
class TestDevisAjustementTaskOnRejection:
    """Point B du ticket : un ajustement refusé crée une Task ALERT
    assignée à l'admin_keyimmo qui vient d'agir — pas de résolveur de
    contact sponsor, `assignee` est déjà connu du contexte de la requête.
    """

    def test_rejected_ajustement_creates_an_alert_task_assigned_to_the_acting_admin(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('task-on-reject')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=BOUNDARY_TEST_AMOUNT,
        )
        way_over = EXPECTED_MARGE_FOR_BOUNDARY_TESTS + Decimal('50000.00')

        response = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': str(way_over)},
            format='json',
        )
        assert response.status_code == 409

        # Lecture directe : la Task appartient à `sponsor_org` (celle du
        # devis/lot), pas à celle de l'admin — bascule RLS nécessaire pour
        # cette relecture de vérification, même discipline que les autres
        # tests RLS de ce module.
        set_rls_context(organization_id=sponsor_org.id)
        task = Task.objects.get(
            subject_type__model='devis', subject_id=devis.id,
            source=DEVIS_AJUSTEMENT_REFUSE_SOURCE,
        )
        assert task.type == TaskType.ALERT
        assert task.assignee_id == admin_user.id
        assert task.status == TaskStatus.PENDING
        # Le libellé identifie le devis concerné (candidat + lot) — Task
        # interne à admin_keyimmo, jamais exposée au candidat (voir
        # TestDevisAjustementAmountNeverLeaksToConstructeurRole).
        assert candidate_a_org.name in task.label
        assert lot.name in task.label

    def test_a_second_rejected_attempt_on_the_same_devis_does_not_duplicate_the_task(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('task-dedup')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=BOUNDARY_TEST_AMOUNT,
        )
        way_over = EXPECTED_MARGE_FOR_BOUNDARY_TESTS + Decimal('50000.00')

        for _ in range(2):
            response = admin_client.post(
                reverse('procurement-devis-ajustement', args=[devis.id]),
                {'organization': str(sponsor_org.id), 'ecart': str(way_over)},
                format='json',
            )
            assert response.status_code == 409

        set_rls_context(organization_id=sponsor_org.id)
        tasks = Task.objects.filter(subject_type__model='devis', subject_id=devis.id)
        assert tasks.count() == 1


@pytest.mark.django_db
class TestDevisImmutability:
    """Critère d'acceptation central : `Devis` et son `marge_estimee`/
    `amount` d'origine ne sont JAMAIS modifiés par ce mécanisme — même
    rigueur que la garde append-only de `TrustEvent` (ticket 003).
    """

    def test_devis_amount_and_marge_estimee_unchanged_after_an_accepted_ajustement(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('immutable-reread')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=AMOUNT_A,
        )

        response = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': '500.00'},
            format='json',
        )
        assert response.status_code == 201, response.data

        set_rls_context(organization_id=sponsor_org.id)
        devis.refresh_from_db()
        assert devis.amount == AMOUNT_A
        assert devis.marge_estimee == _expected_marge(AMOUNT_A)

    def test_direct_sql_update_on_devis_is_blocked_by_rls_no_policy_defined(self):
        """Aucune policy RLS `UPDATE` n'est définie sur `procurement_devis`
        (ticket 022, migration `0002_devis_rls.py`) — sous `FORCE ROW LEVEL
        SECURITY`, ceci bloque par défaut TOUT `UPDATE`, y compris pour le
        rôle propriétaire de la table. Comme pour `TrustEvent` (ticket 003,
        CLAUDE.md section Append-only) : une tentative d'UPDATE en SQL BRUT
        affecte silencieusement 0 ligne, sans lever d'exception — un test
        doit donc vérifier `cursor.rowcount == 0` + donnée inchangée après
        relecture, pas s'attendre à une erreur.
        """
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('immutable-sql-update')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        set_rls_context(organization_id=sponsor_org.id)
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE procurement_devis SET amount = %s WHERE id = %s",
                [str(Decimal('999999.99')), str(devis.id)],
            )
            assert cursor.rowcount == 0

        devis.refresh_from_db()
        assert devis.amount == AMOUNT_A
        assert devis.marge_estimee == _expected_marge(AMOUNT_A)

    def test_direct_sql_delete_on_devis_is_blocked_by_rls_no_policy_defined(self):
        """Même raisonnement que le test précédent, pour DELETE."""
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('immutable-sql-delete')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        set_rls_context(organization_id=sponsor_org.id)
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM procurement_devis WHERE id = %s", [str(devis.id)])
            assert cursor.rowcount == 0

        assert Devis.objects.filter(id=devis.id).exists()

    def test_direct_sql_update_on_devis_ajustement_is_also_blocked(self):
        """Le `DevisAjustement` lui-même est aussi protégé, une fois créé —
        un ajustement accepté n'est jamais révisable après coup (cohérent
        avec le mécanisme append-only : un nouvel ajustement est un
        NOUVEL enregistrement, jamais une édition).
        """
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('immutable-ajustement-sql-update')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        devis = _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=AMOUNT_A,
        )
        response = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': '500.00'},
            format='json',
        )
        assert response.status_code == 201, response.data
        ajustement_id = response.data['id']

        set_rls_context(organization_id=sponsor_org.id)
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE procurement_devis_ajustement SET ecart = %s WHERE id = %s",
                [str(Decimal('0.00')), str(ajustement_id)],
            )
            assert cursor.rowcount == 0

        ajustement = DevisAjustement.objects.get(id=ajustement_id)
        assert ajustement.ecart == Decimal('500.00')


@pytest.mark.django_db
class TestDevisAjustementAmountNeverLeaksToConstructeurRole:
    """Extension de la garde du ticket 022 : `marge_estimee` (sur `Devis`)
    et `ecart`/`marge_resultante` (sur `DevisAjustement`) ne doivent jamais
    apparaître dans une réponse accessible au rôle constructeur, exactement
    comme `amount`.
    """

    def test_marge_estimee_never_appears_in_candidate_responses(self):
        _admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('leak-marge')
        )
        candidate_a_client, candidate_a_org = candidate_a
        devis = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )

        list_response = candidate_a_client.get(reverse('procurement-my-candidatures'))
        detail_response = candidate_a_client.get(
            reverse('procurement-my-candidature-detail', args=[devis.id]),
        )
        for response in (list_response, detail_response):
            body_text = response.content.decode()
            assert 'marge_estimee' not in body_text
            assert str(_expected_marge(AMOUNT_A)) not in body_text


@pytest.mark.django_db
class TestPricingConfigWiring:
    """Ticket 026 — câblage PricingConfig ↔ création de Devis."""

    def test_marge_estimee_is_derived_from_amount_times_the_active_rate(self):
        """`marge_estimee = amount × (rate / 100)` — preuve indépendante de
        la formule de production (`services._derive_marge_estimee`) : ce
        test calcule sa propre attente EXPLICITEMENT (pas via
        `_expected_marge`, qui appelle la MÊME formule que la production)
        et compare le résultat effectivement persisté.
        """
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('formula')
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
        # Calcul indépendant, écrit à la main : 123456.78 × 10 % = 12345.678,
        # arrondi commercial (ROUND_HALF_UP) à 12345.68.
        assert Decimal(response.data['marge_estimee']) == Decimal('12345.68')

    def test_creating_a_devis_without_any_active_pricing_config_is_rejected(self):
        """Point C : bloqué explicitement (409), AUCUNE ligne créée — jamais
        un champ vide ni une valeur par défaut silencieuse.
        `seed_pricing=False` : `_setup_lot_up_for_bid` ne seed PAS de
        `PricingConfig` pour ce test précis.
        """
        admin_client, admin_org, _admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('no-pricing', seed_pricing=False)
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
        assert response.status_code == 409
        assert not Devis.objects.filter(lot=lot, candidate_organization=candidate_a_org).exists()

    def test_marge_estimee_sent_by_the_client_is_silently_ignored(self):
        """Point D (version stricte, invariant 25.10/25.15 du modèle
        économique) : AUCUN override possible, même une valeur
        délibérément différente envoyée par le client — le taux
        effectivement posé reste celui dérivé du `PricingConfig`, jamais
        celui envoyé.
        """
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('override-ignored')
        )
        _candidate_a_client, candidate_a_org = candidate_a

        response = admin_client.post(
            reverse('procurement-devis-create'),
            {
                'organization': str(sponsor_org.id), 'lot': str(lot.id),
                'candidate_organization': str(candidate_a_org.id), 'amount': str(AMOUNT_A),
                'marge_estimee': str(Decimal('999999.99')),
            },
            format='json',
        )
        assert response.status_code == 201, response.data
        assert Decimal(response.data['marge_estimee']) == _expected_marge(AMOUNT_A)
        assert Decimal(response.data['marge_estimee']) != Decimal('999999.99')

    def test_the_governing_country_pack_is_the_lots_not_the_candidates(self):
        """Point A : le `country_pack` déterminant est celui de
        `devis.organization` (le LOT/sponsor), JAMAIS celui du candidat.
        Preuve : le candidat est réassigné à un AUTRE `country_pack`, SANS
        aucun `PricingConfig` actif pour celui-ci — si ce country_pack
        était utilisé par erreur, la création échouerait ici en 409. Elle
        réussit, avec le taux du sponsor (`PRICING_RATE_PERCENT`).
        """
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('country-pack-lot')
        )
        _candidate_a_client, candidate_a_org = candidate_a

        other_country_pack = CountryPack.objects.create(code='CI', label="Côte d'Ivoire")
        candidate_a_org.country_pack = other_country_pack
        candidate_a_org.save(update_fields=['country_pack'])

        response = admin_client.post(
            reverse('procurement-devis-create'),
            {
                'organization': str(sponsor_org.id), 'lot': str(lot.id),
                'candidate_organization': str(candidate_a_org.id), 'amount': str(AMOUNT_A),
            },
            format='json',
        )
        assert response.status_code == 201, response.data
        assert Decimal(response.data['marge_estimee']) == _expected_marge(AMOUNT_A)

    def test_a_later_pricing_config_change_never_affects_an_already_created_devis(self):
        """Non-régression directe de l'immutabilité actée au ticket 024 :
        un `Devis` déjà créé garde son `marge_estimee` d'origine pour
        toujours, même après un changement de taux `PricingConfig`
        postérieur — cohérent avec l'invariant 25.15 (CLAUDE.md).
        """
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('rate-change-after')
        )
        _candidate_a_client, candidate_a_org = candidate_a

        devis = services.create_devis(
            logged_by=admin_user, logged_by_organization_id=admin_org.id,
            target_organization_id=sponsor_org.id, lot_id=lot.id,
            candidate_organization_id=candidate_a_org.id, amount=AMOUNT_A,
        )
        original_marge = devis.marge_estimee

        pricing_services.create_pricing_config(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            canal=PricingCanal.CANAL_1_MARGE, rate=Decimal('99.00'),
        )

        set_rls_context(organization_id=sponsor_org.id)
        devis.refresh_from_db()
        assert devis.marge_estimee == original_marge
        assert devis.marge_estimee == _expected_marge(AMOUNT_A)


@pytest.mark.django_db
class TestAdminOrganizationSearch:
    """`GET /api/procurement/admin/organizations/?q=` — ticket B-028.
    Aucune RLS sur `organizations_organization` : même schéma que
    `apps.backoffice.tests.py::TestUserSearch` (ticket 011), pas de
    bascule à tester ici.
    """

    def test_admin_keyimmo_can_search_organizations_by_name(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'org-search-admin@example.com', 'Org Search Admin',
        )
        Organization.objects.create(name='Constructeur Zébulon', country_pack=CountryPack.objects.get(code='SN'))
        Organization.objects.create(name='Constructeur Autre', country_pack=CountryPack.objects.get(code='SN'))

        response = admin_client.get(reverse('procurement-admin-organization-search'), {'q': 'zébulon'})
        assert response.status_code == 200
        names = [row['name'] for row in response.data]
        assert names == ['Constructeur Zébulon']

    def test_empty_query_returns_an_empty_list_never_a_dump(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'org-search-empty-admin@example.com', 'Org Search Empty Admin',
        )
        Organization.objects.create(name='Une Organisation', country_pack=CountryPack.objects.get(code='SN'))

        response = admin_client.get(reverse('procurement-admin-organization-search'))
        assert response.status_code == 200
        assert response.data == []

    def test_a_constructeur_cannot_search_organizations(self):
        constructeur_client, _org, _user = _register(
            'org-search-forbidden@example.com', 'Org Search Forbidden', role_code='constructeur',
        )
        response = constructeur_client.get(reverse('procurement-admin-organization-search'), {'q': 'a'})
        assert response.status_code == 403

    def test_more_than_max_search_results_matches_are_capped(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'org-search-cap-admin@example.com', 'Org Search Cap Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        total_matching = services.MAX_SEARCH_RESULTS + 5
        Organization.objects.bulk_create([
            Organization(name=f'Org Plafond Recherche {i}', country_pack=senegal)
            for i in range(total_matching)
        ])

        response = admin_client.get(reverse('procurement-admin-organization-search'), {'q': 'Plafond Recherche'})
        assert response.status_code == 200
        assert len(response.data) == services.MAX_SEARCH_RESULTS


@pytest.mark.django_db
class TestAdminLotSearch:
    """`GET /api/procurement/admin/lots/?q=` — ticket B-028. Cœur du
    ticket : boucle de bascule RLS par organisation (voir
    `apps.procurement.services.search_lots_as_admin`).
    """

    def test_admin_keyimmo_can_find_a_lot_in_an_organization_he_is_not_a_member_of(self):
        admin_client, admin_org, _admin_user = _register_admin(
            'lot-search-admin@example.com', 'Org Lot Search Admin',
        )
        sponsor_org, program, _asset, lot = _create_sponsor_org_with_lot('discovery', 'Lot Découverte Unique')
        assert sponsor_org.id != admin_org.id

        response = admin_client.get(reverse('procurement-admin-lot-search'), {'q': 'Découverte'})
        assert response.status_code == 200
        assert len(response.data) == 1
        row = response.data[0]
        assert row['id'] == str(lot.id)
        assert row['name'] == 'Lot Découverte Unique'
        assert row['organization'] == {'id': str(sponsor_org.id), 'name': sponsor_org.name}
        assert row['program'] == {'id': str(program.id), 'name': program.name}

    def test_empty_query_returns_an_empty_list_never_a_dump(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'lot-search-empty-admin@example.com', 'Org Lot Search Empty Admin',
        )
        _create_sponsor_org_with_lot('empty-query', 'Un Lot Quelconque')

        response = admin_client.get(reverse('procurement-admin-lot-search'))
        assert response.status_code == 200
        assert response.data == []

    def test_a_lot_whose_name_does_not_match_is_never_returned(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'lot-search-nomatch-admin@example.com', 'Org Lot Search Nomatch Admin',
        )
        _create_sponsor_org_with_lot('nomatch', 'Lot Sans Rapport')

        response = admin_client.get(reverse('procurement-admin-lot-search'), {'q': 'Introuvable'})
        assert response.status_code == 200
        assert response.data == []

    def test_a_constructeur_cannot_search_lots(self):
        constructeur_client, _org, _user = _register(
            'lot-search-forbidden@example.com', 'Org Lot Search Forbidden', role_code='constructeur',
        )
        response = constructeur_client.get(reverse('procurement-admin-lot-search'), {'q': 'a'})
        assert response.status_code == 403

    def test_locked_lots_are_excluded_across_the_multi_organization_loop(self):
        """Cœur du critère d'acceptation « exclusion des lots verrouillés » —
        DEUX organisations différentes, un lot du MÊME nom dans chacune :
        un seul verrouillé. Prouve que l'exclusion s'applique lot par lot,
        PAS organisation par organisation (le lot non verrouillé de la
        SECONDE organisation testée par la boucle doit rester visible).
        """
        admin_client, admin_org, admin_user = _register_admin(
            'lot-search-locked-admin@example.com', 'Org Lot Search Locked Admin',
        )
        locked_org, _p1, _a1, locked_lot = _create_sponsor_org_with_lot('locked', 'Lot Commun Verrouillé')
        open_org, _p2, _a2, open_lot = _create_sponsor_org_with_lot('open', 'Lot Commun Verrouillé')

        pricing_services.create_pricing_config(
            admin=admin_user, country_pack_id=locked_org.country_pack_id,
            canal=PricingCanal.CANAL_1_MARGE, rate=PRICING_RATE_PERCENT,
        )
        _candidate_client, candidate_org, _candidate_user = _register(
            'lot-search-locked-candidate@example.com', 'Org Lot Search Locked Candidate', role_code='constructeur',
        )
        _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=locked_org, lot=locked_lot,
            candidate_org=candidate_org, amount=AMOUNT_A,
        )

        response = admin_client.get(reverse('procurement-admin-lot-search'), {'q': 'Lot Commun Verrouillé'})
        assert response.status_code == 200
        returned_ids = {row['id'] for row in response.data}
        assert str(locked_lot.id) not in returned_ids
        assert str(open_lot.id) in returned_ids

    def test_more_than_max_search_results_matches_are_capped(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'lot-search-cap-admin@example.com', 'Org Lot Search Cap Admin',
        )
        total_matching = services.MAX_SEARCH_RESULTS + 5
        for i in range(total_matching):
            _create_sponsor_org_with_lot(f'cap-{i}', f'Lot Plafond Recherche {i}')

        response = admin_client.get(reverse('procurement-admin-lot-search'), {'q': 'Plafond Recherche'})
        assert response.status_code == 200
        assert len(response.data) == services.MAX_SEARCH_RESULTS

    def test_a_search_matching_nothing_still_iterates_every_organization_worst_case(self):
        """Preuve directe du point A (ticket + CLAUDE.md) : `MAX_SEARCH_
        RESULTS` borne les RÉSULTATS retournés, JAMAIS le nombre de
        requêtes exécutées — une recherche sans aucune correspondance
        continue de basculer le contexte RLS vers CHAQUE organisation
        existante avant de répondre (pire cas O(nombre d'organisations)),
        au lieu de s'arrêter tôt faute de résultat.
        """
        admin_client, admin_org, admin_user = _register_admin(
            'lot-search-worst-case-admin@example.com', 'Org Lot Search Worst Case Admin',
        )
        sponsor_org_1, _p1, _a1, _lot1 = _create_sponsor_org_with_lot('worst-case-1', 'Lot Alpha')
        sponsor_org_2, _p2, _a2, _lot2 = _create_sponsor_org_with_lot('worst-case-2', 'Lot Beta')
        sponsor_org_3, _p3, _a3, _lot3 = _create_sponsor_org_with_lot('worst-case-3', 'Lot Gamma')
        every_organization_id = {admin_org.id, sponsor_org_1.id, sponsor_org_2.id, sponsor_org_3.id}

        with mock.patch(
            'apps.procurement.services.set_rls_context', wraps=services.set_rls_context,
        ) as rls_context_spy:
            response = admin_client.get(
                reverse('procurement-admin-lot-search'), {'q': 'AUCUNE-CORRESPONDANCE-XYZ'},
            )

        assert response.status_code == 200
        assert response.data == []

        organization_ids_switched_to = {
            call.kwargs['organization_id']
            for call in rls_context_spy.call_args_list
            if 'organization_id' in call.kwargs
        }
        assert every_organization_id <= organization_ids_switched_to

    def test_rls_context_is_restored_even_when_an_exception_interrupts_the_loop(self):
        """Le `finally` englobe TOUTE la boucle (pas par itération) — une
        exception levée en cours de boucle doit quand même restaurer le
        contexte RLS de l'appelant, jamais le laisser bloqué sur la
        dernière organisation testée.
        """
        _admin_client, admin_org, admin_user = _register_admin(
            'lot-search-exception-admin@example.com', 'Org Lot Search Exception Admin',
        )
        _sponsor_org, _p, _a, _lot = _create_sponsor_org_with_lot('exception-case', 'Lot Exception Test')

        with mock.patch('apps.procurement.services.is_lot_locked', side_effect=RuntimeError('boom')):
            with pytest.raises(RuntimeError):
                services.search_lots_as_admin(
                    admin=admin_user, admin_organization_id=admin_org.id, query='Lot Exception',
                )

        # Contexte restauré vers `admin_org` malgré l'exception, SANS
        # aucune bascule manuelle ici : une lecture RLS-scopée normale sur
        # cette organisation ne doit PAS voir le lot du sponsor (qui
        # appartient à une AUTRE organisation) — si la restauration
        # automatique (le `finally` de `search_lots_as_admin`) avait
        # échoué (contexte resté bloqué sur le sponsor), cette lecture
        # verrait le lot à tort.
        assert not Lot.objects.filter(name__icontains='Exception Test').exists()


def _seed_program_cost_for_lot(
    *, admin_user, admin_org, sponsor_org, lot, foncier_total, be_total,
    repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES,
):
    """Ticket B-035 : crée un `ProgramCost` pour le programme du lot donné.
    Bascule RLS explicite avant de lire `lot.asset.program_id` — même
    piège déjà documenté pour `get_devis_lot_detail` (ticket B-029) :
    `lot` est un objet Python déjà chargé, mais `lot.asset` (jamais mis en
    cache par les helpers d'enregistrement) déclencherait sinon une
    requête FRAÎCHE sous le contexte RLS courant (potentiellement celui
    d'une AUTRE organisation, laissée active par le dernier appel
    `_register`/`_register_admin` de la fixture appelante).
    """
    set_rls_context(organization_id=sponsor_org.id)
    program_id = lot.asset.program_id
    set_rls_context(organization_id=admin_org.id)
    return programs_services.create_program_cost(
        admin=admin_user, admin_organization_id=admin_org.id,
        target_organization_id=sponsor_org.id, program_id=program_id,
        foncier_total=foncier_total, be_total=be_total,
        repartition_method=repartition_method, justification='Test B-035',
    )


def _setup_lot_ledger_ready(
    suffix, *, devis_amount=BOUNDARY_TEST_AMOUNT,
    foncier_total=Decimal('5000000.00'), be_total=Decimal('1000000.00'),
):
    """Ticket B-035 : un lot avec un devis VERROUILLÉ et un `ProgramCost`
    (`parts_egales`, un seul lot dans ce programme — chaque lot reçoit
    100% des montants, aucune division en jeu) déjà en place, prêt pour
    `POST /api/procurement/lot-ledgers/`.
    """
    admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, candidate_b = (
        _setup_lot_up_for_bid(suffix)
    )
    _candidate_a_client, candidate_a_org = candidate_a
    devis = _create_and_lock_devis(
        admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
        candidate_org=candidate_a_org, amount=devis_amount,
    )
    _seed_program_cost_for_lot(
        admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
        foncier_total=foncier_total, be_total=be_total,
    )
    return admin_client, admin_org, admin_user, sponsor_org, lot, devis, candidate_a, candidate_b


def _create_mission_for_lot(*, admin_client, admin_user, admin_org, sponsor_org, lot, milestone_code, suffix):
    """Ticket B-036 : crée une VRAIE `InspectionMission` via l'endpoint réel
    `backoffice-mission-create` (pas un raccourci `apps.inspections.
    services.create_mission` appelé directement) — exerce la chaîne
    complète vue → service → `record_bc_charge_for_mission`, effet de bord
    au cœur de ce ticket.

    Les jalons du lot ne sont PAS instanciés par `_setup_lot_up_for_bid`
    (helper générique du module, jamais eu besoin de jalons avant ce
    ticket) — instanciés ici, une seule fois par lot (`lot.milestones.
    exists()` évite un second appel s'il y a plusieurs missions sur le
    même lot dans un même test).

    Un inspecteur FRAÎCHEMENT enregistré dans SA PROPRE organisation à
    chaque appel — la règle d'indépendance du contrôle (ticket 005)
    interdit un inspecteur membre de l'organisation cible ; `suffix` doit
    être unique par appel pour éviter toute collision d'email/organisation
    entre deux missions du même test.
    """
    set_rls_context(organization_id=sponsor_org.id)
    if not lot.milestones.exists():
        instantiate_milestones_for_lot(lot)
    milestone = lot.milestones.get(code=milestone_code)
    declaration = create_work_declaration(organization=sponsor_org, milestone=milestone, declared_by=admin_user)
    set_rls_context(organization_id=admin_org.id)

    _inspecteur_client, _inspecteur_org, inspecteur_user = _register(
        f'inspecteur-{suffix}@example.com', f'Org Inspecteur {suffix}', role_code='inspecteur',
    )

    return admin_client.post(
        reverse('backoffice-mission-create'),
        {
            'organization': str(sponsor_org.id),
            'work_declaration': str(declaration.id),
            'assigned_inspector': str(inspecteur_user.id),
        },
        format='json',
    )


@pytest.mark.django_db
class TestLotLedgerCreation:
    """Ticket B-035 — grand-livre de coûts par lot (canal 1), première
    partie. Décisions D (précondition devis verrouillé) et B (un seul
    grand-livre par lot) vérifiées ici.
    """

    def test_admin_keyimmo_can_create_a_lot_ledger_once_devis_is_locked(self):
        admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('create')
        )

        response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert response.status_code == 201, response.data
        assert Decimal(response.data['prix_client']) == Decimal('20000000.00')
        # Un seul lot dans ce programme (parts_egales) : la part de CE lot
        # vaut le TOTAL du ProgramCost, aucune division n'entre en jeu ici.
        assert Decimal(response.data['foncier_alloue']) == Decimal('5000000.00')
        assert Decimal(response.data['be_alloue']) == Decimal('1000000.00')
        assert response.data['lot'] == lot.id
        assert response.data['organization'] == sponsor_org.id

    def test_a_constructeur_cannot_create_a_lot_ledger(self):
        _admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('forbidden')
        )
        candidate_a_client, _candidate_a_org = candidate_a

        response = candidate_a_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert response.status_code == 403

    def test_creation_without_a_locked_devis_is_rejected_and_creates_no_row(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('not-locked')
        )
        _seed_program_cost_for_lot(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            foncier_total=Decimal('5000000.00'), be_total=Decimal('1000000.00'),
        )
        # AUCUN devis créé/verrouillé pour ce lot — précondition D non remplie.

        response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert response.status_code == 409

        set_rls_context(organization_id=sponsor_org.id)
        assert not LotLedger.objects.filter(lot=lot).exists()

    def test_creation_without_any_program_cost_is_rejected_and_creates_no_row(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('no-program-cost')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=BOUNDARY_TEST_AMOUNT,
        )
        # Devis verrouillé, mais AUCUN ProgramCost enregistré pour ce
        # programme — rien à répartir (même famille que
        # ProgramCostRepartitionView, ticket B-033).

        response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert response.status_code == 409

        set_rls_context(organization_id=sponsor_org.id)
        assert not LotLedger.objects.filter(lot=lot).exists()

    def test_a_second_ledger_for_the_same_lot_via_the_api_is_rejected(self):
        admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('duplicate')
        )
        first = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert first.status_code == 201, first.data

        second = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '99999999.00'},
            format='json',
        )
        assert second.status_code == 409

        set_rls_context(organization_id=sponsor_org.id)
        assert LotLedger.objects.filter(lot=lot).count() == 1

    def test_direct_db_insert_bypassing_the_service_violates_the_unique_constraint(self):
        """Décision B, garantie DB — pas seulement applicative : une
        tentative d'`INSERT` en base qui violerait DIRECTEMENT la
        contrainte `UNIQUE` du `OneToOneField` `lot` est rejetée par
        PostgreSQL lui-même (`IntegrityError`), même en contournant
        entièrement `create_lot_ledger`/sa vérification préalable — même
        preuve que `TestLegalPaymentTierTemplateUniqueness` (ticket B-027,
        `apps/pricing/tests.py`).
        """
        admin_client, _admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('db-constraint')
        )
        response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert response.status_code == 201, response.data

        set_rls_context(organization_id=sponsor_org.id)
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                LotLedger.objects.create(
                    organization=sponsor_org, lot=lot, prix_client=Decimal('1.00'),
                    foncier_alloue=Decimal('1.00'), be_alloue=Decimal('1.00'), created_by=admin_user,
                )


@pytest.mark.django_db
class TestLotLedgerSnapshot:
    """Décision E : `foncier_alloue`/`be_alloue` sont un snapshot figé
    depuis `compute_lot_repartition` (ticket B-033) au moment de la
    création — jamais recalculé après, même si `ProgramCost` change
    ensuite (nouvelle révision).
    """

    def test_snapshot_matches_repartition_with_parts_egales_across_two_lots(self):
        admin_client, admin_org, admin_user, sponsor_org, lot_a, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('parts-egales')
        )
        _candidate_a_client, candidate_a_org = candidate_a

        set_rls_context(organization_id=sponsor_org.id)
        Lot.objects.create(organization=sponsor_org, asset=lot_a.asset, name='Second lot')
        set_rls_context(organization_id=admin_org.id)

        _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot_a,
            candidate_org=candidate_a_org, amount=BOUNDARY_TEST_AMOUNT,
        )
        _seed_program_cost_for_lot(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot_a,
            foncier_total=Decimal('5000000.00'), be_total=Decimal('1000000.00'),
            repartition_method=ProgramCostRepartitionMethod.PARTS_EGALES,
        )

        response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot_a.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert response.status_code == 201, response.data
        # Deux lots, parts égales : chacun reçoit exactement la moitié.
        assert Decimal(response.data['foncier_alloue']) == Decimal('2500000.00')
        assert Decimal(response.data['be_alloue']) == Decimal('500000.00')

    def test_snapshot_matches_repartition_with_prorata_surface(self):
        admin_client, admin_org, admin_user, sponsor_org, lot_a, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('prorata-surface')
        )
        _candidate_a_client, candidate_a_org = candidate_a

        set_rls_context(organization_id=sponsor_org.id)
        lot_a.surface = Decimal('100.00')
        lot_a.save(update_fields=['surface'])
        Lot.objects.create(
            organization=sponsor_org, asset=lot_a.asset, name='Second lot', surface=Decimal('300.00'),
        )
        set_rls_context(organization_id=admin_org.id)

        _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot_a,
            candidate_org=candidate_a_org, amount=BOUNDARY_TEST_AMOUNT,
        )
        _seed_program_cost_for_lot(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot_a,
            foncier_total=Decimal('4000000.00'), be_total=Decimal('800000.00'),
            repartition_method=ProgramCostRepartitionMethod.PRORATA_SURFACE,
        )

        response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot_a.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert response.status_code == 201, response.data
        # lot_a = 100 / (100 + 300) = 25% de chaque total.
        assert Decimal(response.data['foncier_alloue']) == Decimal('1000000.00')
        assert Decimal(response.data['be_alloue']) == Decimal('200000.00')

    def test_a_later_program_cost_revision_never_changes_an_already_created_snapshot(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready(
                'frozen-snapshot', foncier_total=Decimal('5000000.00'), be_total=Decimal('1000000.00'),
            )
        )
        response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert response.status_code == 201, response.data
        original_foncier = Decimal(response.data['foncier_alloue'])
        original_be = Decimal(response.data['be_alloue'])
        assert original_foncier == Decimal('5000000.00')
        assert original_be == Decimal('1000000.00')

        # Nouvelle révision ProgramCost, totaux TRÈS différents.
        _seed_program_cost_for_lot(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            foncier_total=Decimal('99999999.00'), be_total=Decimal('88888888.00'),
        )

        detail_response = admin_client.get(
            reverse('lot-ledger-detail', args=[lot.id]), {'organization_id': str(sponsor_org.id)},
        )
        assert detail_response.status_code == 200
        assert Decimal(detail_response.data['foncier_alloue']) == original_foncier
        assert Decimal(detail_response.data['be_alloue']) == original_be


@pytest.mark.django_db
class TestLotLedgerMargin:
    """Décision F : marge disponible calculée À LA VOLÉE, formule
    VOLONTAIREMENT INCOMPLÈTE dans ce ticket (TODO B-036, terme bureau de
    contrôle absent).
    """

    def test_margin_equals_prix_client_minus_foncier_be_minus_construction_amount(self):
        admin_client, _admin_org, _admin_user, sponsor_org, lot, devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready(
                'margin-basic', devis_amount=BOUNDARY_TEST_AMOUNT,
                foncier_total=Decimal('5000000.00'), be_total=Decimal('1000000.00'),
            )
        )
        create_response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert create_response.status_code == 201, create_response.data

        # Preuve que `construction_courante` inclut bien l'ajustement, pas
        # seulement `devis.amount` seul (même discipline que le critère
        # d'acceptation `TestDevisAjustementCumulativeSigned`).
        ajustement_response = admin_client.post(
            reverse('procurement-devis-ajustement', args=[devis.id]),
            {'organization': str(sponsor_org.id), 'ecart': '1000.00'},
            format='json',
        )
        assert ajustement_response.status_code == 201, ajustement_response.data

        margin_response = admin_client.get(
            reverse('lot-ledger-margin', args=[lot.id]), {'organization_id': str(sponsor_org.id)},
        )
        assert margin_response.status_code == 200
        # prix_client (20000000) - foncier_alloue (5000000) - be_alloue
        # (1000000) - construction_courante (BOUNDARY_TEST_AMOUNT + 1000).
        expected_construction = BOUNDARY_TEST_AMOUNT + Decimal('1000.00')
        expected_margin = (
            Decimal('20000000.00') - Decimal('5000000.00') - Decimal('1000000.00') - expected_construction
        )
        assert margin_response.data['margin'] == expected_margin

    def test_margin_endpoint_returns_404_when_no_ledger_exists_yet(self):
        admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('margin-missing')
        )
        # Aucun grand-livre créé pour ce lot.

        response = admin_client.get(
            reverse('lot-ledger-margin', args=[lot.id]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 404

    def test_a_constructeur_cannot_read_the_margin(self):
        _admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('margin-forbidden')
        )
        candidate_a_client, _candidate_a_org = candidate_a

        response = candidate_a_client.get(
            reverse('lot-ledger-margin', args=[lot.id]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 403


@pytest.mark.django_db
class TestLotLedgerDetail:
    def test_reading_a_lot_without_a_ledger_returns_null(self):
        admin_client, _admin_org, _admin_user, sponsor_org, lot, _candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('detail-null')
        )
        response = admin_client.get(
            reverse('lot-ledger-detail', args=[lot.id]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 200
        assert response.data is None

    def test_a_constructeur_cannot_read_a_lot_ledger(self):
        _admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('detail-forbidden')
        )
        candidate_a_client, _candidate_a_org = candidate_a

        response = candidate_a_client.get(
            reverse('lot-ledger-detail', args=[lot.id]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 403


@pytest.mark.django_db
class TestLotLedgerImmutability:
    """Décision C : `LotLedger` n'est jamais révisé après création — même
    niveau que `Devis`/`ProgramCost` (aucune policy RLS `UPDATE`/`DELETE`).
    """

    def test_no_update_or_delete_function_exists_in_services(self):
        assert not hasattr(services, 'update_lot_ledger')
        assert not hasattr(services, 'delete_lot_ledger')

    def test_direct_sql_update_on_lot_ledger_is_blocked_by_rls_no_policy_defined(self):
        admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('immutable-sql-update')
        )
        response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert response.status_code == 201, response.data
        ledger_id = response.data['id']

        set_rls_context(organization_id=sponsor_org.id)
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE procurement_lot_ledger SET prix_client = %s WHERE id = %s",
                [str(Decimal('1.00')), str(ledger_id)],
            )
            assert cursor.rowcount == 0

        ledger = LotLedger.objects.get(id=ledger_id)
        assert ledger.prix_client == Decimal('20000000.00')

    def test_direct_sql_delete_on_lot_ledger_is_blocked_by_rls_no_policy_defined(self):
        admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('immutable-sql-delete')
        )
        response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert response.status_code == 201, response.data
        ledger_id = response.data['id']

        set_rls_context(organization_id=sponsor_org.id)
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM procurement_lot_ledger WHERE id = %s", [str(ledger_id)])
            assert cursor.rowcount == 0

        assert LotLedger.objects.filter(id=ledger_id).exists()


@pytest.mark.django_db
class TestLotBcChargeFixedAmount:
    """Ticket B-036, décision 1 : une entrée `fixed_amount` pour le
    `jalon_type` PRÉCIS d'une mission produit une charge CUMULATIVE — une
    par mission qui y correspond, jamais consommée une seule fois.
    """

    def test_two_missions_on_the_same_fixed_amount_jalon_produce_two_cumulative_charges(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('bc-fixed-cumulative')
        )
        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type='fondations', calculation_mode=ControlOfficeCalculationMode.FIXED_AMOUNT,
            fixed_amount=Decimal('50000.00'),
        )

        first_response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='fondations', suffix='fixed-cumulative-1',
        )
        assert first_response.status_code == 201, first_response.data
        second_response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='fondations', suffix='fixed-cumulative-2',
        )
        assert second_response.status_code == 201, second_response.data

        set_rls_context(organization_id=sponsor_org.id)
        charges = list(LotBcCharge.objects.filter(lot=lot).order_by('created_at', 'sequence'))
        assert len(charges) == 2
        assert all(charge.montant == Decimal('50000.00') for charge in charges)
        assert all(not charge.is_global_reference for charge in charges)


@pytest.mark.django_db
class TestLotBcChargeGlobalPercentage:
    """Ticket B-036, décisions 2/C/E : le mode `percentage`/« global » se
    déclenche AU PLUS UNE FOIS PAR LOT, à la première mission pour
    laquelle aucune entrée `fixed_amount` n'existe pour son `jalon_type`
    précis — jamais répété aux missions suivantes du même lot.
    """

    def test_first_mission_without_a_fixed_rate_consumes_the_global_entry(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('bc-global-first', devis_amount=Decimal('1000000.00'))
        )
        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type=GLOBAL_CONTROL_OFFICE_JALON_TYPE,
            calculation_mode=ControlOfficeCalculationMode.PERCENTAGE, percentage=Decimal('5.00'),
        )

        response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='conception', suffix='global-first',
        )
        assert response.status_code == 201, response.data

        set_rls_context(organization_id=sponsor_org.id)
        charge = LotBcCharge.objects.get(lot=lot)
        assert charge.is_global_reference is True
        assert charge.montant == Decimal('50000.00')  # 1 000 000 × 5 %
        assert charge.jalon_type == 'conception'

    def test_second_mission_on_a_different_jalon_without_fixed_rate_produces_no_charge(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('bc-global-second', devis_amount=Decimal('1000000.00'))
        )
        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type=GLOBAL_CONTROL_OFFICE_JALON_TYPE,
            calculation_mode=ControlOfficeCalculationMode.PERCENTAGE, percentage=Decimal('5.00'),
        )

        first_response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='conception', suffix='global-second-1',
        )
        assert first_response.status_code == 201, first_response.data
        second_response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='gros_oeuvre', suffix='global-second-2',
        )
        assert second_response.status_code == 201, second_response.data  # jamais bloquée

        set_rls_context(organization_id=sponsor_org.id)
        assert LotBcCharge.objects.filter(lot=lot).count() == 1


@pytest.mark.django_db
class TestLotBcChargeNoRateConfigured:
    """Ticket B-036, décision 3 : aucune entrée applicable (ni fixe ni
    globale) → la mission est créée normalement, AUCUNE charge, jamais un
    blocage.
    """

    def test_mission_created_normally_with_no_applicable_rate_at_all(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('bc-no-rate')
        )

        response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='conception', suffix='no-rate',
        )
        assert response.status_code == 201, response.data

        set_rls_context(organization_id=sponsor_org.id)
        assert not LotBcCharge.objects.filter(lot=lot).exists()


@pytest.mark.django_db
class TestLotBcChargeDevisNotLockedYet:
    """Ticket B-036, décision G : le mode global s'applique au montant
    construction courant, indéfinissable sans devis verrouillé — aucune
    charge n'est créée dans ce cas, ET l'entrée globale N'EST PAS marquée
    consommée : elle reste disponible pour une mission ultérieure sur ce
    même lot, une fois le devis verrouillé.
    """

    def test_global_mode_without_a_locked_devis_produces_no_charge_and_stays_available(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('bc-devis-not-locked')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type=GLOBAL_CONTROL_OFFICE_JALON_TYPE,
            calculation_mode=ControlOfficeCalculationMode.PERCENTAGE, percentage=Decimal('5.00'),
        )
        # Aucun devis verrouillé pour ce lot à ce stade.

        first_response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='conception', suffix='devis-not-locked-1',
        )
        assert first_response.status_code == 201, first_response.data

        set_rls_context(organization_id=sponsor_org.id)
        assert not LotBcCharge.objects.filter(lot=lot).exists()

        # Verrouille le devis APRÈS la première mission.
        _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=Decimal('1000000.00'),
        )

        second_response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='gros_oeuvre', suffix='devis-not-locked-2',
        )
        assert second_response.status_code == 201, second_response.data

        set_rls_context(organization_id=sponsor_org.id)
        charge = LotBcCharge.objects.get(lot=lot)
        assert charge.is_global_reference is True
        assert charge.montant == Decimal('50000.00')
        assert charge.jalon_type == 'gros_oeuvre'


@pytest.mark.django_db
class TestLotLedgerMarginIncludesBcCharges:
    """Ticket B-036, décision H : `get_lot_ledger_margin` ferme le TODO
    laissé par B-035 — la marge soustrait désormais la somme des charges
    BC du lot, fixes et globale confondues.
    """

    def test_margin_subtracts_cumulative_bc_charges(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready(
                'bc-margin', devis_amount=Decimal('1000000.00'),
                foncier_total=Decimal('5000000.00'), be_total=Decimal('1000000.00'),
            )
        )
        create_response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert create_response.status_code == 201, create_response.data

        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type='fondations', calculation_mode=ControlOfficeCalculationMode.FIXED_AMOUNT,
            fixed_amount=Decimal('50000.00'),
        )
        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type=GLOBAL_CONTROL_OFFICE_JALON_TYPE,
            calculation_mode=ControlOfficeCalculationMode.PERCENTAGE, percentage=Decimal('2.00'),
        )

        fixed_response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='fondations', suffix='margin-fixed',
        )
        assert fixed_response.status_code == 201, fixed_response.data
        global_response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='conception', suffix='margin-global',
        )
        assert global_response.status_code == 201, global_response.data

        margin_response = admin_client.get(
            reverse('lot-ledger-margin', args=[lot.id]), {'organization_id': str(sponsor_org.id)},
        )
        assert margin_response.status_code == 200
        # prix_client 20 000 000 - foncier 5 000 000 - be 1 000 000
        # - construction 1 000 000 - charge fixe 50 000
        # - charge globale (1 000 000 × 2 % = 20 000).
        expected_margin = (
            Decimal('20000000.00') - Decimal('5000000.00') - Decimal('1000000.00')
            - Decimal('1000000.00') - Decimal('50000.00') - Decimal('20000.00')
        )
        assert margin_response.data['margin'] == expected_margin


@pytest.mark.django_db
class TestLotBcChargeNegativeMarginAlert:
    """Ticket B-036, décisions 3/I : la création d'une charge BC n'est
    JAMAIS bloquée par la marge disponible — si elle passe sous zéro, une
    Task ALERT se déclenche, jamais un rejet de la mission.
    """

    def test_mission_creation_succeeds_and_triggers_an_alert_when_margin_goes_negative(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready(
                'bc-alert', devis_amount=Decimal('1000000.00'),
                foncier_total=Decimal('500000.00'), be_total=Decimal('100000.00'),
            )
        )
        # prix_client délibérément TRÈS bas : foncier + BE + construction
        # seuls dépassent déjà ce montant, la charge BC n'a même pas besoin
        # d'être grande pour faire basculer la marge sous zéro.
        create_response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '1000000.00'},
            format='json',
        )
        assert create_response.status_code == 201, create_response.data

        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type='fondations', calculation_mode=ControlOfficeCalculationMode.FIXED_AMOUNT,
            fixed_amount=Decimal('50000.00'),
        )

        response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='fondations', suffix='alert',
        )
        assert response.status_code == 201, response.data  # jamais bloquée par la marge

        set_rls_context(organization_id=sponsor_org.id)
        ledger = LotLedger.objects.get(lot=lot)
        assert services.get_lot_ledger_margin(ledger) < Decimal('0')

        task = Task.objects.get(subject_type__model='lotledger', subject_id=ledger.id)
        assert task.source == LOT_LEDGER_MARGIN_NEGATIVE_SOURCE
        assert task.type == TaskType.ALERT
        assert task.assignee_id == admin_user.id
        assert task.status == TaskStatus.PENDING
        assert lot.name in task.label


@pytest.mark.django_db
class TestLotBcChargeWithoutLedger:
    """Ticket B-036, décision A : une charge BC doit TOUJOURS pouvoir être
    enregistrée, y compris pour un lot dont le grand-livre n'existe pas
    ENCORE — la marge reste indéfinie, mais la charge, elle, s'accumule.
    """

    def test_mission_and_charge_created_normally_even_without_a_lot_ledger(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('bc-no-ledger')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=Decimal('1000000.00'),
        )
        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type='fondations', calculation_mode=ControlOfficeCalculationMode.FIXED_AMOUNT,
            fixed_amount=Decimal('50000.00'),
        )
        # Aucun LotLedger créé pour ce lot.

        response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='fondations', suffix='no-ledger',
        )
        assert response.status_code == 201, response.data

        set_rls_context(organization_id=sponsor_org.id)
        assert LotBcCharge.objects.filter(lot=lot).exists()
        assert not Task.objects.filter(source=LOT_LEDGER_MARGIN_NEGATIVE_SOURCE).exists()


@pytest.mark.django_db
class TestLotBcChargeImmutability:
    """`LotBcCharge` est append-only, jamais révisé après création — même
    niveau que `DevisAjustement`/`LotLedger` (aucune policy RLS
    `UPDATE`/`DELETE`).
    """

    def test_no_update_or_delete_function_exists_in_services(self):
        assert not hasattr(services, 'update_lot_bc_charge')
        assert not hasattr(services, 'delete_lot_bc_charge')

    def test_direct_sql_update_on_lot_bc_charge_is_blocked_by_rls_no_policy_defined(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('bc-immutable-update')
        )
        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type='fondations', calculation_mode=ControlOfficeCalculationMode.FIXED_AMOUNT,
            fixed_amount=Decimal('50000.00'),
        )
        response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='fondations', suffix='immutable-update',
        )
        assert response.status_code == 201, response.data

        set_rls_context(organization_id=sponsor_org.id)
        charge = LotBcCharge.objects.get(lot=lot)
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE procurement_lot_bc_charge SET montant = %s WHERE id = %s",
                [str(Decimal('1.00')), str(charge.id)],
            )
            assert cursor.rowcount == 0

        charge.refresh_from_db()
        assert charge.montant == Decimal('50000.00')

    def test_direct_sql_delete_on_lot_bc_charge_is_blocked_by_rls_no_policy_defined(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('bc-immutable-delete')
        )
        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type='fondations', calculation_mode=ControlOfficeCalculationMode.FIXED_AMOUNT,
            fixed_amount=Decimal('50000.00'),
        )
        response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='fondations', suffix='immutable-delete',
        )
        assert response.status_code == 201, response.data

        set_rls_context(organization_id=sponsor_org.id)
        charge = LotBcCharge.objects.get(lot=lot)
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM procurement_lot_bc_charge WHERE id = %s", [str(charge.id)])
            assert cursor.rowcount == 0

        assert LotBcCharge.objects.filter(id=charge.id).exists()


@pytest.mark.django_db
class TestLotBcChargeListEndpoint:
    """Ticket B-036, décision J : historique complet des charges BC d'un
    lot, chronologique, réservé `admin_keyimmo`.
    """

    def test_lists_all_charges_for_a_lot_chronologically(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('bc-list')
        )
        pricing_services.create_control_office_rate(
            admin=admin_user, country_pack_id=sponsor_org.country_pack_id,
            jalon_type='fondations', calculation_mode=ControlOfficeCalculationMode.FIXED_AMOUNT,
            fixed_amount=Decimal('50000.00'),
        )
        first_response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='fondations', suffix='list-1',
        )
        assert first_response.status_code == 201, first_response.data
        second_response = _create_mission_for_lot(
            admin_client=admin_client, admin_user=admin_user, admin_org=admin_org,
            sponsor_org=sponsor_org, lot=lot, milestone_code='fondations', suffix='list-2',
        )
        assert second_response.status_code == 201, second_response.data

        response = admin_client.get(
            reverse('lot-bc-charge-list', args=[lot.id]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 200
        assert len(response.data) == 2
        assert [Decimal(row['montant']) for row in response.data] == [Decimal('50000.00'), Decimal('50000.00')]

    def test_empty_list_when_no_charge_exists_yet(self):
        admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('bc-list-empty')
        )

        response = admin_client.get(
            reverse('lot-bc-charge-list', args=[lot.id]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 200
        assert response.data == []

    def test_a_constructeur_cannot_list_bc_charges(self):
        _admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('bc-list-forbidden')
        )
        candidate_a_client, _candidate_a_org = candidate_a

        response = candidate_a_client.get(
            reverse('lot-bc-charge-list', args=[lot.id]), {'organization_id': str(sponsor_org.id)},
        )
        assert response.status_code == 403


@pytest.mark.django_db
class TestAdminLotEligibleForLedgerSearch:
    """`GET /api/procurement/admin/lots/eligible-for-ledger/?q=` — ticket
    B-037. Réutilise le MÊME mécanisme de recherche que
    `TestAdminLotSearch` (B-028, classe volontairement laissée INCHANGÉE
    par ce ticket — voir `apps.procurement.services.
    _search_lots_by_name_as_admin`), avec un critère d'inclusion INVERSE :
    devis déjà VERROUILLÉ, ET aucun `LotLedger` existant encore.
    """

    def test_admin_keyimmo_can_find_an_eligible_lot_in_an_organization_he_is_not_a_member_of(self):
        admin_client, admin_org, admin_user, sponsor_org, lot, candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('eligible-search')
        )
        _candidate_a_client, candidate_a_org = candidate_a
        _create_and_lock_devis(
            admin_user=admin_user, admin_org=admin_org, sponsor_org=sponsor_org, lot=lot,
            candidate_org=candidate_a_org, amount=AMOUNT_A,
        )
        assert sponsor_org.id != admin_org.id

        response = admin_client.get(
            reverse('procurement-admin-lot-eligible-for-ledger-search'), {'q': lot.name},
        )
        assert response.status_code == 200
        assert len(response.data) == 1
        row = response.data[0]
        assert row['id'] == str(lot.id)
        assert row['name'] == lot.name
        assert row['organization'] == {'id': str(sponsor_org.id), 'name': sponsor_org.name}

    def test_a_lot_without_a_locked_devis_is_excluded(self):
        admin_client, _admin_org, _admin_user, _sponsor_org, lot, _candidate_a, _candidate_b = (
            _setup_lot_up_for_bid('eligible-not-locked')
        )
        # Aucun devis créé/verrouillé pour ce lot.

        response = admin_client.get(
            reverse('procurement-admin-lot-eligible-for-ledger-search'), {'q': lot.name},
        )
        assert response.status_code == 200
        assert response.data == []

    def test_a_lot_that_already_has_a_ledger_is_excluded(self):
        admin_client, _admin_org, _admin_user, sponsor_org, lot, _devis, _candidate_a, _candidate_b = (
            _setup_lot_ledger_ready('eligible-has-ledger')
        )
        create_response = admin_client.post(
            reverse('lot-ledger-create'),
            {'organization': str(sponsor_org.id), 'lot': str(lot.id), 'prix_client': '20000000.00'},
            format='json',
        )
        assert create_response.status_code == 201, create_response.data

        response = admin_client.get(
            reverse('procurement-admin-lot-eligible-for-ledger-search'), {'q': lot.name},
        )
        assert response.status_code == 200
        assert response.data == []

    def test_empty_query_returns_an_empty_list_never_a_dump(self):
        admin_client, _admin_org, _admin_user = _register_admin(
            'lot-eligible-search-empty-admin@example.com', 'Org Lot Eligible Search Empty Admin',
        )

        response = admin_client.get(reverse('procurement-admin-lot-eligible-for-ledger-search'))
        assert response.status_code == 200
        assert response.data == []

    def test_a_constructeur_cannot_search(self):
        constructeur_client, _org, _user = _register(
            'lot-eligible-search-forbidden@example.com', 'Org Lot Eligible Search Forbidden',
            role_code='constructeur',
        )

        response = constructeur_client.get(
            reverse('procurement-admin-lot-eligible-for-ledger-search'), {'q': 'a'},
        )
        assert response.status_code == 403

    def test_more_than_max_search_results_matches_are_capped(self):
        """Même preuve que `TestAdminLotSearch::
        test_more_than_max_search_results_matches_are_capped` (B-028),
        mais chaque lot doit ici être ÉLIGIBLE (devis verrouillé) pour
        compter — organisations candidates créées directement par l'ORM
        (pas de vrai compte, aucun besoin d'authentification pour une
        `candidate_organization`), un seul `PricingConfig` Sénégal partagé
        par toutes les itérations (même country pack pour chaque sponsor).
        """
        admin_client, admin_org, admin_user = _register_admin(
            'lot-eligible-search-cap-admin@example.com', 'Org Lot Eligible Search Cap Admin',
        )
        senegal = CountryPack.objects.get(code='SN')
        pricing_services.create_pricing_config(
            admin=admin_user, country_pack_id=senegal.id,
            canal=PricingCanal.CANAL_1_MARGE, rate=PRICING_RATE_PERCENT,
        )

        total_matching = services.MAX_SEARCH_RESULTS + 5
        for i in range(total_matching):
            sponsor_org, _program, _asset, lot = _create_sponsor_org_with_lot(
                f'eligible-cap-{i}', f'Lot Plafond Eligible {i}',
            )
            candidate_org = Organization.objects.create(
                name=f'Org Candidate Eligible Cap {i}', country_pack=senegal,
            )
            devis = services.create_devis(
                logged_by=admin_user, logged_by_organization_id=admin_org.id,
                target_organization_id=sponsor_org.id, lot_id=lot.id,
                candidate_organization_id=candidate_org.id, amount=AMOUNT_A,
            )
            services.lock_devis(
                admin=admin_user, admin_organization_id=admin_org.id,
                target_organization_id=sponsor_org.id, devis_id=devis.id,
            )

        response = admin_client.get(
            reverse('procurement-admin-lot-eligible-for-ledger-search'), {'q': 'Plafond Eligible'},
        )
        assert response.status_code == 200
        assert len(response.data) == services.MAX_SEARCH_RESULTS
