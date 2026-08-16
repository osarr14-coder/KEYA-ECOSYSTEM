from apps.accounts.models import User
from apps.core.rls import set_rls_context
from apps.organizations.models import Membership

MAX_SEARCH_RESULTS = 50


def search_users(query):
    """`User` n'est pas scopé par organisation (identité globale, voir
    `apps.accounts.models`) : aucune policy RLS ne s'applique à cette
    table — une recherche cross-organisation est donc un simple filtre
    applicatif, jamais un contournement RLS. `query` vide : liste vide,
    jamais un dump complet de la table.
    """
    if not query:
        return User.objects.none()
    return User.objects.filter(email__icontains=query).order_by('email')[:MAX_SEARCH_RESULTS]


def get_user_memberships(*, admin_user, target_user):
    """`organizations_membership.membership_select` (ticket 001) n'autorise
    QUE la lecture de ses PROPRES lignes (`user_id = current_user`) — à
    dessein, voir le commentaire de sa migration : jamais de lecture
    élargie par rôle au niveau de la policy elle-même. Une tentative en ce
    sens (une branche `OR EXISTS (SELECT ... FROM organizations_membership
    ...)` dans la policy elle-même) a été essayée puis abandonnée : Postgres
    détecte une récursion infinie dans une policy qui référence sa propre
    table sous `FORCE ROW LEVEL SECURITY`, et la parade usuelle (fonction
    `SECURITY DEFINER` avec `row_security = off`) échoue elle aussi pour la
    même raison — `FORCE ROW LEVEL SECURITY` interdit explicitement à
    quiconque, y compris le propriétaire de la table, de désactiver la RLS
    par ce biais (message Postgres : « la requête pourrait être affectée
    par une politique de sécurité »).

    Solution retenue : basculer temporairement `app.current_user_id` sur
    l'utilisateur CIBLE, le temps de CETTE lecture seule — ses propres
    lignes deviennent visibles sous la policy EXISTANTE, INCHANGÉE, sans
    qu'aucun élargissement de policy ne soit nécessaire. Restauré dans un
    `finally`, même schéma que `apps.inspections.services.create_inspection`
    (ticket 005) : une exception étroite et documentée, jamais un
    contournement général de RLS.

    L'appelant (`IsAdminKeyimmo`, voir permissions.py) a déjà vérifié que
    `admin_user` a le droit d'appeler cette fonction — elle ne revérifie
    rien elle-même, comme le reste des fonctions de service de ce projet
    qui présupposent un appelant déjà autorisé.
    """
    set_rls_context(user_id=target_user.id)
    try:
        return list(
            Membership.objects.filter(user=target_user).select_related('organization', 'role'),
        )
    finally:
        set_rls_context(user_id=admin_user.id)


def deactivate_user(user):
    """Bloque l'accès IMMÉDIATEMENT — `JWTAuthentication.get_user`
    (`rest_framework_simplejwt`) revérifie `is_active` à CHAQUE requête
    authentifiée, pas seulement à l'émission du token (voir
    `apps/backoffice/tests.py` pour la preuve avec un JWT déjà émis avant
    la désactivation). Ne supprime ni ne modifie AUCUNE autre donnée :
    `TrustEvent`, `Message`, `Document`, `Membership` restent tous intacts
    et consultables — critère d'acceptation du ticket 011.
    """
    user.is_active = False
    user.save(update_fields=['is_active'])
    return user
