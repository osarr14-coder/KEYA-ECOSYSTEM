import pytest
from django.db import connection

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Membership, Organization, Role
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot

from . import repository
from .models import TrustEvent, TrustEventIsImmutable, TrustLevel


def _create_org_with_milestone(email, organization_name):
    """Organisation + acteur + Program→Asset→Lot→Milestone créés
    directement en base (hors API), contexte RLS posé explicitement — même
    technique que la fixture `two_orgs` du ticket 001.
    """
    senegal = CountryPack.objects.get(code='SN')
    organization = Organization.objects.create(name=organization_name, country_pack=senegal)
    user = User.objects.create_user(email=email, password='pass12345')
    role, _ = Role.objects.get_or_create(code='sponsor', defaults={'label': 'Sponsor'})

    set_rls_context(user_id=user.id, organization_id=organization.id)
    Membership.objects.create(user=user, organization=organization, role=role)

    program = Program.objects.create(organization=organization, name='Programme')
    asset = Asset.objects.create(organization=organization, program=program, name='Bien')
    lot = Lot.objects.create(organization=organization, asset=asset, name='Lot')
    instantiate_milestones_for_lot(lot)
    milestone = lot.milestones.first()

    return organization, user, milestone


@pytest.mark.django_db
class TestAppendOnly:
    """Ticket 003 — critère d'acceptation : impossible de modifier ou
    supprimer un TrustEvent existant, y compris par un rôle admin — vérifié
    par une tentative explicite en SQL brut (pas seulement via l'ORM, qui ne
    tenterait jamais ces opérations de toute façon).

    Sans policy RLS UPDATE/DELETE définie sur `trust_event` (volontaire, voir
    la migration 0002), PostgreSQL refuse par défaut : la ligne cible n'est
    tout simplement pas visible pour ces commandes, l'opération affecte donc
    0 ligne silencieusement plutôt que de lever une exception. Le trigger
    (aussi posé par la migration 0002) est le filet de sécurité qui
    continuerait à bloquer même si une policy UPDATE/DELETE était ajoutée
    par erreur plus tard — voir `test_append_only_trigger_exists_in_the_database`
    ci-dessous, qui garde spécifiquement son existence.
    """

    def test_update_affects_zero_rows_and_leaves_data_unchanged(self):
        organization, user, milestone = _create_org_with_milestone(
            'appendonly-update@example.com', 'Org Append-Only Update',
        )
        event = repository.create(
            subject=milestone, organization=organization, level=TrustLevel.DECLARE,
            actor=user, source='declaration_terrain',
        )
        original_level = event.level

        with connection.cursor() as cursor:
            cursor.execute(
                'UPDATE trust_event SET level = %s WHERE id = %s',
                [TrustLevel.VALIDE, str(event.id)],
            )
            assert cursor.rowcount == 0

        event.refresh_from_db()
        assert event.level == original_level

    def test_delete_affects_zero_rows_and_the_event_still_exists(self):
        organization, user, milestone = _create_org_with_milestone(
            'appendonly-delete@example.com', 'Org Append-Only Delete',
        )
        event = repository.create(
            subject=milestone, organization=organization, level=TrustLevel.DECLARE,
            actor=user, source='declaration_terrain',
        )

        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM trust_event WHERE id = %s', [str(event.id)])
            assert cursor.rowcount == 0

        assert TrustEvent.objects.filter(id=event.id).exists()

    def test_append_only_trigger_exists_in_the_database(self):
        """Garde structurelle explicitement demandée par le ticket : si une
        future migration supprime ce trigger — la seule protection qui
        résisterait à l'ajout ultérieur d'une policy RLS UPDATE/DELETE —, ce
        test échoue immédiatement plutôt que de laisser la régression passer
        inaperçue.
        """
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT tgname FROM pg_trigger "
                "WHERE tgrelid = 'trust_event'::regclass AND NOT tgisinternal",
            )
            trigger_names = {row[0] for row in cursor.fetchall()}

        assert trigger_names == {'trust_event_no_update', 'trust_event_no_delete'}

    def test_repository_exposes_no_update_or_delete_function(self):
        assert not hasattr(repository, 'update')
        assert not hasattr(repository, 'delete')


@pytest.mark.django_db
class TestPythonLevelImmutabilityGuard:
    """Complète les tests DB ci-dessus : quelqu'un qui contourne
    `apps.trust.repository` (ex : `TrustEvent.objects.filter(...).update()`
    directement) doit obtenir une exception Python explicite immédiatement,
    pas un échec silencieux à 0 ligne — le silence est exactement ce que RLS
    seule produirait (voir tests ci-dessus), ce qui serait piégeux pour un
    futur développeur qui ne passerait pas par le repository.
    """

    def test_queryset_update_raises_immediately(self):
        organization, user, milestone = _create_org_with_milestone(
            'guard-update@example.com', 'Org Guard Update',
        )
        event = repository.create(
            subject=milestone, organization=organization, level=TrustLevel.DECLARE,
            actor=user, source='declaration_terrain',
        )

        with pytest.raises(TrustEventIsImmutable):
            TrustEvent.objects.filter(id=event.id).update(level=TrustLevel.VALIDE)

        event.refresh_from_db()
        assert event.level == TrustLevel.DECLARE

    def test_queryset_delete_raises_immediately(self):
        organization, user, milestone = _create_org_with_milestone(
            'guard-delete@example.com', 'Org Guard Delete',
        )
        event = repository.create(
            subject=milestone, organization=organization, level=TrustLevel.DECLARE,
            actor=user, source='declaration_terrain',
        )

        with pytest.raises(TrustEventIsImmutable):
            TrustEvent.objects.filter(id=event.id).delete()

        assert TrustEvent.objects.filter(id=event.id).exists()

    def test_instance_save_on_existing_row_raises_immediately(self):
        organization, user, milestone = _create_org_with_milestone(
            'guard-save@example.com', 'Org Guard Save',
        )
        event = repository.create(
            subject=milestone, organization=organization, level=TrustLevel.DECLARE,
            actor=user, source='declaration_terrain',
        )

        event.level = TrustLevel.VALIDE
        with pytest.raises(TrustEventIsImmutable):
            event.save()

        event.refresh_from_db()
        assert event.level == TrustLevel.DECLARE

    def test_instance_delete_raises_immediately(self):
        organization, user, milestone = _create_org_with_milestone(
            'guard-instance-delete@example.com', 'Org Guard Instance Delete',
        )
        event = repository.create(
            subject=milestone, organization=organization, level=TrustLevel.DECLARE,
            actor=user, source='declaration_terrain',
        )

        with pytest.raises(TrustEventIsImmutable):
            event.delete()

        assert TrustEvent.objects.filter(id=event.id).exists()


@pytest.mark.django_db
class TestCorrectionChain:
    """Ticket 003 — critère d'acceptation : une correction crée un nouvel
    événement avec previous_event_id renseigné, l'événement original reste
    inchangé.
    """

    def test_correction_creates_new_event_and_leaves_original_untouched(self):
        organization, user, milestone = _create_org_with_milestone(
            'correction@example.com', 'Org Correction',
        )

        original = repository.create(
            subject=milestone, organization=organization, level=TrustLevel.CONTROLE,
            actor=user, source='inspection', scope='lot',
        )
        original_snapshot = {
            'level': original.level, 'source': original.source, 'scope': original.scope,
            'actor_id': original.actor_id, 'created_at': original.created_at,
            'previous_event_id': original.previous_event_id,
        }

        correction = repository.create(
            subject=milestone, organization=organization, level=TrustLevel.VERIFIE,
            actor=user, source='nouvelle_inspection', scope='lot', previous_event=original,
        )

        original.refresh_from_db()
        assert {
            'level': original.level, 'source': original.source, 'scope': original.scope,
            'actor_id': original.actor_id, 'created_at': original.created_at,
            'previous_event_id': original.previous_event_id,
        } == original_snapshot

        assert correction.previous_event_id == original.id
        assert TrustEvent.objects.filter(subject_id=milestone.pk).count() == 2


@pytest.mark.django_db
class TestGetCurrentStatus:
    """Ticket 003 — critère d'acceptation : getCurrentStatus ne fait jamais
    de calcul de score — elle retourne un des 5 niveaux Visible Trust avec
    sa provenance complète (source, date, acteur, scope), jamais un
    pourcentage.
    """

    def test_returns_the_latest_event_with_full_provenance(self):
        organization, user, milestone = _create_org_with_milestone(
            'status@example.com', 'Org Status',
        )
        original = repository.create(
            subject=milestone, organization=organization, level=TrustLevel.DECLARE,
            actor=user, source='declaration_terrain',
        )
        correction = repository.create(
            subject=milestone, organization=organization, level=TrustLevel.DOCUMENTE,
            actor=user, source='upload_document', scope='lot', previous_event=original,
        )

        current = repository.get_current_status(milestone)

        assert current.id == correction.id
        assert current.level == TrustLevel.DOCUMENTE
        assert current.source == 'upload_document'
        assert current.scope == 'lot'
        assert current.actor_id == user.id
        assert current.created_at is not None
        # Pas de score/pourcentage : ces attributs ne doivent même pas exister.
        assert not hasattr(current, 'score')
        assert not hasattr(current, 'percentage')

    def test_returns_none_when_subject_has_no_event_yet(self):
        _organization, _user, milestone = _create_org_with_milestone(
            'status-none@example.com', 'Org Status Vide',
        )
        assert repository.get_current_status(milestone) is None


@pytest.mark.django_db
class TestTrustEventIsOrganizationScoped:
    """Complète la couverture RLS pour la nouvelle table `trust_event`,
    suivant le pattern déjà appliqué à Program/Asset/Lot (ticket 002)."""

    def test_trust_event_of_another_organization_is_not_visible(self):
        organization_a, user_a, milestone_a = _create_org_with_milestone(
            'trustrls-a@example.com', 'Org Trust RLS A',
        )
        repository.create(
            subject=milestone_a, organization=organization_a, level=TrustLevel.DECLARE,
            actor=user_a, source='declaration_terrain',
        )

        organization_b, user_b, _milestone_b = _create_org_with_milestone(
            'trustrls-b@example.com', 'Org Trust RLS B',
        )
        # Bascule explicite du contexte RLS sur l'organisation B — simule
        # une requête authentifiée comme user_b.
        set_rls_context(user_id=user_b.id, organization_id=organization_b.id)

        assert repository.get_current_status(milestone_a) is None
        assert not TrustEvent.objects.filter(organization=organization_a).exists()
