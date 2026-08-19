import uuid

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from apps.organizations.models import Organization
from apps.programs.models import Program


class TaskType(models.TextChoices):
    """Les 4 types définis en V3.0 §15.2 — vocabulaire fixe de la doctrine
    produit (comme `TrustLevel`, ticket 003 ; comme `SensitivityLevel`,
    ticket 004), pas une configuration par pays. Toujours renseigné, jamais
    déduit implicitement : c'est ce qui rend les 4 types « structurellement
    distincts » (critère d'acceptation ticket 006), pas seulement une liste
    non typée d'éléments qui se ressembleraient.
    """

    TASK = 'task', 'Tâche'
    NOTIFICATION = 'notification', 'Notification'
    ALERT = 'alert', 'Alerte'
    EXCEPTION = 'exception', 'Exception'


class TaskPriority(models.TextChoices):
    LOW = 'low', 'Faible'
    NORMAL = 'normal', 'Normale'
    HIGH = 'high', 'Haute'


class TaskStatus(models.TextChoices):
    PENDING = 'pending', 'En attente'
    DONE = 'done', 'Traitée'


class Task(models.Model):
    """Élément d'inbox transversal — polymorphe vers tout objet métier,
    exactement comme `TrustEvent` (ticket 003) : `subject_type`/`subject_id`
    via `django.contrib.contenttypes`, pas de FK directe vers chaque type de
    sujet possible.

    `status` est un champ réellement STOCKÉ ici, et c'est volontaire : la
    doctrine « le statut ne se stocke jamais, il se dérive du dernier
    TrustEvent » (CLAUDE.md) concerne les objets Visible Trust (Milestone,
    WorkDeclaration, Evidence, Reserve — dont le statut est une AFFIRMATION
    DE CONFIANCE avec provenance). Une `Task` n'affirme aucune confiance sur
    le sujet qu'elle référence — c'est un objet opérationnel d'inbox, dont
    le statut (traitée ou non) est un fait sur LA TASK ELLE-MÊME, jamais sur
    le sujet. Marquer une Task traitée ne doit d'ailleurs jamais toucher au
    TrustEvent/Reserve source — critère d'acceptation ticket 006, voir
    `apps/tasks/services.py::complete_task`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='tasks',
    )

    type = models.CharField(max_length=20, choices=TaskType.choices)

    subject_type = models.ForeignKey(ContentType, on_delete=models.PROTECT)
    subject_id = models.UUIDField()
    subject = GenericForeignKey('subject_type', 'subject_id')

    program = models.ForeignKey(
        Program, on_delete=models.PROTECT, related_name='tasks', null=True, blank=True,
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='tasks',
    )

    # D'où vient cette Task (ex. 'reserve_opened') — même convention que
    # `TrustEvent.source`/`Document.source` ailleurs dans ce projet.
    source = models.CharField(max_length=100)

    # Pas listé explicitement dans les champs du ticket, mais indispensable
    # à son critère d'acceptation central : « le libellé doit toujours
    # nommer l'acteur responsable ». Un inbox sans texte lisible ne pourrait
    # pas satisfaire ce critère. Généré une fois à la création, jamais
    # recalculé (voir apps/tasks/services.py).
    label = models.CharField(max_length=255)

    due_date = models.DateTimeField(null=True, blank=True)
    priority = models.CharField(max_length=10, choices=TaskPriority.choices, default=TaskPriority.NORMAL)
    status = models.CharField(max_length=10, choices=TaskStatus.choices, default=TaskStatus.PENDING)

    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'tasks_task'
        indexes = [
            models.Index(fields=['assignee', 'status']),
        ]
        constraints = [
            # Ticket 017 : une seule Task par (sujet précis, raison de
            # génération) — quel que soit le nombre de fois où le générateur
            # qui la crée est réellement exécuté (redélivrance broker, rejeu
            # manuel, double appel `.delay()` côté appelant). Voir
            # `apps.tasks.services._get_or_create_task`, qui s'appuie sur
            # CETTE contrainte pour rattraper explicitement la course entre
            # deux transactions concurrentes.
            models.UniqueConstraint(
                fields=['subject_type', 'subject_id', 'source'],
                name='unique_task_per_subject_and_source',
            ),
        ]

    def __str__(self):
        return f'[{self.type}] {self.label}'
