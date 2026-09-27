from rest_framework.permissions import BasePermission

from apps.organizations.models import Membership

ADMIN_KEYIMMO_ROLE_CODE = 'admin_keyimmo'
GESTIONNAIRE_ADV_ROLE_CODE = 'gestionnaire_adv'
FINANCE_ROLE_CODE = 'finance'


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


def _has_any_role(user, role_codes):
    if not user.is_authenticated:
        return False
    return Membership.objects.filter(user=user, role__code__in=role_codes).exists()


class IsFinance(BasePermission):
    """Ticket B-050 (rôle reporté de B-046) — opérateur de SIMULATION des
    flux financiers (CDC V3 §4), jamais une banque partenaire : enregistre
    encaissements et décaissements simulés, les affecte et les rapproche.
    `admin_keyimmo` ne cumule volontairement PAS ce pouvoir (CDC §4 : « les
    comptes démontrant des fonctions incompatibles sont distincts ») — même
    sémantique transverse que les autres rôles de l'équipe KEYIMMO."""

    message = 'Réservé aux membres du rôle finance.'

    def has_permission(self, request, view):
        return _has_any_role(request.user, [FINANCE_ROLE_CODE])


class IsKeyimmoTeam(BasePermission):
    """Ticket B-050 — lecture commune de l'équipe KEYIMMO (admin, ADV,
    Finance) sur les objets de vente : chacun doit voir les appels de fonds
    pour faire son propre travail, sans pour autant pouvoir faire celui des
    autres (les écritures gardent leur permission dédiée)."""

    message = "Réservé à l'équipe KEYIMMO (admin_keyimmo, gestionnaire_adv, finance)."

    def has_permission(self, request, view):
        return _has_any_role(
            request.user, [ADMIN_KEYIMMO_ROLE_CODE, GESTIONNAIRE_ADV_ROLE_CODE, FINANCE_ROLE_CODE],
        )

