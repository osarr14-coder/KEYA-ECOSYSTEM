from decimal import ROUND_HALF_UP, Decimal

import pytest
from django.db import connection
from django.db.utils import ProgrammingError
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.evidence.services import create_work_declaration
from apps.organizations.models import CountryPack, Membership, Organization, Role
from apps.pricing.models import PricingCanal
from apps.pricing import services as pricing_services
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot
from apps.tasks.models import Task, TaskStatus, TaskType
from apps.tasks.services import DEVIS_AJUSTEMENT_REFUSE_SOURCE
from apps.trust.models import TrustEvent

from . import services
from .models import Devis, DevisAjustement

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
