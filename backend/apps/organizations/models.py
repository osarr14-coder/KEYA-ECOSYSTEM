import uuid

from django.conf import settings
from django.db import models


class CountryPack(models.Model):
    """Configuration variable par pays. Une seule ligne au MVP ('Sénégal'),
    mais toujours une donnée — jamais un choix en dur dans le code applicatif.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=10, unique=True)
    label = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'organizations_country_pack'
        verbose_name = 'Country Pack'

    def __str__(self):
        return self.label


class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    country_pack = models.ForeignKey(
        CountryPack, on_delete=models.PROTECT, related_name='organizations',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'organizations_organization'

    def __str__(self):
        return self.name


class Role(models.Model):
    """Valeurs de départ du MVP : client, sponsor, constructeur, inspecteur,
    admin_keyimmo. Table plutôt qu'enum pour ne pas coder les rôles en dur
    dans le code métier — la matrice de permissions fine (ABAC) est hors
    scope de ce ticket et viendra s'appuyer dessus plus tard.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    label = models.CharField(max_length=100)

    class Meta:
        db_table = 'organizations_role'

    def __str__(self):
        return self.label


class Membership(models.Model):
    """Un rôle unique par (user, organization) pour le MVP — multi-rôle par
    organisation est explicitement hors scope du ticket 001.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='memberships',
    )
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='memberships',
    )
    role = models.ForeignKey(
        Role, on_delete=models.PROTECT, related_name='memberships',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'organizations_membership'
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'organization'], name='unique_role_per_user_per_org',
            ),
        ]

    def __str__(self):
        return f'{self.user.email} — {self.organization.name} — {self.role.code}'
