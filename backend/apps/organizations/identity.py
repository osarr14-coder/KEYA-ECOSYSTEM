"""PO-2026-09-28-18 — une personne s'affiche « organisation · rôle »
(ex. « Constructeur Démonstration Abidjan · Constructeur »), jamais par son
e-mail ni avec une double parenthèse : niveaux de confiance, pièces et
chronologie.

L'organisation d'un acteur est portée par son rattachement
(`organizations_membership`), dont la policy RLS ne laisse lire que SES
PROPRES lignes (`user_id = current_user`, ticket 001). Même exception
étroite et documentée que `apps.backoffice.services.get_user_memberships` :
`app.current_user_id` bascule sur l'acteur le temps de CETTE seule lecture,
puis est restauré dans un `finally`. Rien d'autre n'est lu : seuls le nom
de l'organisation et le libellé du rôle sortent de cette fonction.
"""
from django.db import connection

from apps.core.rls import USER_SESSION_VAR, set_rls_context

from .models import Membership

# Libellés d'affichage des rôles (glossaire de l'audit UI R1) : le contrôleur
# est un « Contrôleur », jamais un « inspecteur » à l'écran.
ROLE_DISPLAY = {
    'constructeur': 'Constructeur',
    'inspecteur': 'Contrôleur',
    'gestionnaire_adv': 'Gestionnaire',
    'finance': 'Finance',
    'admin_keyimmo': 'Administrateur',
    # PO-2026-09-28-34 : « Nom fictif · Client(e) » dans le back-office.
    'client': 'Client(e)',
    'sponsor': 'Constructeur',
    'notaire': 'Notaire',
}
# Compte personnel d'un client : son nom contient l'e-mail, jamais affiché.
PERSONAL_ACCOUNT_PREFIX = 'Compte personnel'

SEPARATOR = ' · '
NO_USER = '00000000-0000-0000-0000-000000000000'


def _current_user_setting():
    with connection.cursor() as cursor:
        cursor.execute('SELECT current_setting(%s, true)', [USER_SESSION_VAR])
        value = cursor.fetchone()[0]
    return value or None


def _memberships_of(user):
    previous = _current_user_setting()
    set_rls_context(user_id=user.id)
    try:
        return list(Membership.objects.filter(user=user).select_related('organization', 'role').order_by('created_at'))
    finally:
        # Sans utilisateur courant (commande, tâche), un identifiant nul :
        # plus aucune ligne de rattachement ne reste lisible.
        set_rls_context(user_id=previous or NO_USER)


def actor_parts(user, expected_role='', cache=None):
    """`(organisation, rôle)` affichables de `user`. `expected_role` (code,
    ex. « inspecteur ») départage plusieurs rattachements et sert de repli
    quand aucun n'est lisible. `cache` : dict facultatif partagé par un même
    calcul (une lecture par acteur)."""
    if user is None:
        return '', ROLE_DISPLAY.get(expected_role, '')
    key = (user.id, expected_role)
    if cache is not None and key in cache:
        return cache[key]
    memberships = _memberships_of(user)
    chosen = next((m for m in memberships if m.role.code == expected_role), memberships[0] if memberships else None)
    if chosen is None:
        parts = ('', ROLE_DISPLAY.get(expected_role, ''))
    else:
        organization = chosen.organization.name
        if organization.startswith(PERSONAL_ACCOUNT_PREFIX):
            # Compte personnel d'un client : son nom fictif, jamais l'e-mail
            # que porte le nom de l'organisation (PO-2026-09-28-34).
            organization = user.full_name if chosen.role.code == 'client' else ''
        role = ROLE_DISPLAY.get(chosen.role.code) or (chosen.role.label or '').capitalize()
        parts = (organization, role)
    if cache is not None:
        cache[key] = parts
    return parts


def actor_label(user, expected_role='', cache=None):
    """« organisation · rôle » (ou le seul élément connu)."""
    return SEPARATOR.join(part for part in actor_parts(user, expected_role, cache) if part)


# Niveau d'un TrustEvent → rôle attendu de son auteur (départage seulement).
_EVENT_ROLE = {'declare': 'constructeur', 'documente': 'constructeur'}


def event_actor_label(event, cache=None):
    """Auteur d'un `TrustEvent`, « organisation · rôle »."""
    return actor_label(event.actor, _EVENT_ROLE.get(event.level, 'inspecteur'), cache)
