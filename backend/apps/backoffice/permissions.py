from rest_framework.permissions import BasePermission

from apps.organizations.models import Membership

ADMIN_KEYIMMO_ROLE_CODE = 'admin_keyimmo'
GESTIONNAIRE_ADV_ROLE_CODE = 'gestionnaire_adv'


class IsAdminKeyimmo(BasePermission):
    """KEYIMMO est l'opérateur de la plateforme, pas un tenant parmi
    d'autres — contrairement à `IsInspecteur`/`IsConstructeur` (ticket 005),
    qui vérifient le rôle DANS l'organisation active de la requête, cette
    permission vérifie que l'utilisateur détient `admin_keyimmo` dans
    N'IMPORTE LAQUELLE de ses organisations : un back-office est par nature
    une capacité transverse à toutes les organisations, pas limitée à
    celle actuellement active.

    `user=request.user` (jamais un autre utilisateur) passe sans problème
    la policy RLS existante de `organizations_membership`
    (`user_id = current_user`, ticket 001) — aucun contournement
    nécessaire pour CETTE vérification précise (contrairement à la lecture
    du back-office sur un utilisateur CIBLE, voir services.py).
    """

    message = 'Réservé aux membres du rôle admin_keyimmo.'

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return Membership.objects.filter(
            user=request.user, role__code=ADMIN_KEYIMMO_ROLE_CODE,
        ).exists()


class IsAdminKeyimmoOrGestionnaireADV(BasePermission):
    """Ticket B-046 (Phase 1 de `docs/audit-cdc-v3-mvp-ecart-vefa.md`) —
    sépare les pouvoirs « préparer le scénario métier » (création de
    programme/bien/lot, décision sur les demandes de programme sur mesure)
    du reste des capacités `admin_keyimmo` (tarifs, devis, back-office
    utilisateurs), conformément au CDC V3 §4 : « comptes démontrant des
    fonctions incompatibles sont distincts ».

    ADDITIVE, jamais une restriction : `admin_keyimmo` garde tous ses
    pouvoirs actuels (un admin est de fait habilité aux actions ADV) — ce
    n'est qu'un SECOND chemin d'accès pour un compte `gestionnaire_adv` qui
    n'a pas besoin d'être aussi `admin_keyimmo`. Même sémantique « rôle dans
    N'IMPORTE LAQUELLE des organisations » que `IsAdminKeyimmo` ci-dessus
    (jamais l'organisation active) : la préparation de programmes est par
    nature une capacité transverse, pas limitée à un lieu.

    Rôle `finance` du CDC volontairement PAS ajouté ici — voir la section
    « Ajustement de séquencement » du ticket B-046 : aucun objet financier
    n'existe encore pour qu'une telle permission protège quoi que ce soit.
    """

    message = 'Réservé aux membres des rôles admin_keyimmo ou gestionnaire_adv.'

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return Membership.objects.filter(
            user=request.user,
            role__code__in=[ADMIN_KEYIMMO_ROLE_CODE, GESTIONNAIRE_ADV_ROLE_CODE],
        ).exists()
