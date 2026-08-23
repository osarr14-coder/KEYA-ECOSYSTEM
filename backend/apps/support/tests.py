import pytest
from django.core.exceptions import ValidationError
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import Membership, Organization, Role
from apps.programs.models import Asset, Lot, Program
from apps.programs.services import instantiate_milestones_for_lot

from .models import LitigeStatus
from .services import open_litige, resolve_litige

PASSWORD = 'strongpass123'


def _setup_org_with_lot(email, organization_name):
    client = APIClient()
    client.post(
        reverse('register'),
        {'email': email, 'password': PASSWORD, 'organization_name': organization_name},
        format='json',
    )
    user = User.objects.get(email=email)
    organization = Organization.objects.get(name=organization_name)
    set_rls_context(user_id=user.id, organization_id=organization.id)

    program = Program.objects.create(organization=organization, name='Programme')
    asset = Asset.objects.create(organization=organization, program=program, name='Bien')
    lot = Lot.objects.create(organization=organization, asset=asset, name='Lot')
    instantiate_milestones_for_lot(lot)
    return organization, user, lot


@pytest.mark.django_db
class TestOpenLitige:
    def test_opens_with_ouvert_status(self):
        organization, user, lot = _setup_org_with_lot('support-open@example.com', 'Org Support Open')

        litige = open_litige(organization=organization, lot=lot, opened_by=user, description='Un problème.')

        assert litige.status == LitigeStatus.OUVERT
        assert litige.organization_id == organization.id
        assert litige.resolved_at is None
        assert litige.resolved_by is None

    def test_rejects_an_empty_description(self):
        organization, user, lot = _setup_org_with_lot('support-open-empty@example.com', 'Org Support Open Empty')

        with pytest.raises(ValidationError):
            open_litige(organization=organization, lot=lot, opened_by=user, description='   ')


@pytest.mark.django_db
class TestResolveLitige:
    def _open(self, suffix):
        organization, user, lot = _setup_org_with_lot(f'support-resolve-{suffix}@example.com', f'Org Support Resolve {suffix}')
        return open_litige(organization=organization, lot=lot, opened_by=user, description='Un problème.'), user

    def test_resolve_sets_terminal_status_and_resolution_fields(self):
        litige, admin = self._open('a')

        resolved = resolve_litige(
            litige=litige, resolved_by=admin, status=LitigeStatus.RESOLU, resolution_note='Réglé.',
        )

        assert resolved.status == LitigeStatus.RESOLU
        assert resolved.resolution_note == 'Réglé.'
        assert resolved.resolved_by_id == admin.id
        assert resolved.resolved_at is not None

    def test_reject_status_also_works(self):
        litige, admin = self._open('b')

        resolved = resolve_litige(
            litige=litige, resolved_by=admin, status=LitigeStatus.REJETE, resolution_note='Non fondé.',
        )

        assert resolved.status == LitigeStatus.REJETE

    def test_rejects_a_non_terminal_target_status(self):
        litige, admin = self._open('c')

        with pytest.raises(ValidationError):
            resolve_litige(litige=litige, resolved_by=admin, status=LitigeStatus.OUVERT, resolution_note='Note.')

    def test_rejects_an_empty_resolution_note(self):
        litige, admin = self._open('d')

        with pytest.raises(ValidationError):
            resolve_litige(litige=litige, resolved_by=admin, status=LitigeStatus.RESOLU, resolution_note='   ')

    def test_rejects_resolving_an_already_terminal_litige(self):
        litige, admin = self._open('e')
        resolve_litige(litige=litige, resolved_by=admin, status=LitigeStatus.RESOLU, resolution_note='Réglé.')

        with pytest.raises(ValidationError):
            resolve_litige(litige=litige, resolved_by=admin, status=LitigeStatus.REJETE, resolution_note='Encore.')
