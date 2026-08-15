from rest_framework.permissions import BasePermission

from apps.organizations.models import Membership

INSPECTEUR_ROLE_CODE = 'inspecteur'


class IsInspecteur(BasePermission):
    """Seul un membre avec le rôle `inspecteur` peut créer une Inspection —
    ticket 005, scope explicite. C'est la SEULE porte d'entrée qui fait
    progresser le cycle de vie d'une `Reserve` vers `nouvelle_inspection`,
    `levee` ou `rejetee` : un constructeur bloqué ici ne peut, par
    construction, changer le statut d'aucune réserve.

    Vérifie le rôle dans l'organisation ACTIVE de la requête (celle de
    l'inspecteur lui-même) — l'indépendance vis-à-vis de l'organisation du
    lot inspecté est une règle séparée, vérifiée par
    `apps.inspections.services.create_inspection`.
    """

    message = 'Seul un membre avec le rôle inspecteur peut créer une inspection.'

    def has_permission(self, request, view):
        organization = getattr(request, 'organization', None)
        if organization is None or not request.user.is_authenticated:
            return False
        return Membership.objects.filter(
            user=request.user, organization=organization, role__code=INSPECTEUR_ROLE_CODE,
        ).exists()
