"""PO-2026-09-29-11 (T05, CDC §12.1 « tentative tracée ») — toute tentative
d'écriture refusée pour un motif de droits est inscrite au journal d'audit.

Constat de la revue assistée (docs/recette/REVUE_ASSISTEE_R1.md) : le
constructeur qui tentait d'accepter un jalon ou de lever une réserve était
bien refusé (403, 405) sans mutation, mais la tentative ne laissait qu'une
ligne dans le journal technique du serveur, sans acteur ni objet.

Périmètre : requêtes d'écriture (POST, PUT, PATCH, DELETE) authentifiées,
sous `/api/`, refusées par 403 (droits) ou 405 (opération non offerte).
Hors périmètre : lectures refusées, visiteurs anonymes, refus de règle
métier (409), erreurs de saisie (400).

Placé juste après `OrganizationScopeMiddleware` : l'inscription se fait dans
la transaction de la requête, sous le contexte RLS de l'organisation active
de l'acteur (policy d'insertion du journal). Aucune donnée saisie n'est
recopiée : seuls la route, la méthode, le motif affiché et les identifiants
visés (paramètres d'URL, champs du corps dont la valeur est un identifiant).
"""
import json
import uuid

from apps.core.rls import set_rls_context

from .models import AuditEvent

WRITE_METHODS = ('POST', 'PUT', 'PATCH', 'DELETE')
TRACED_STATUSES = (403, 405)
ACTION = 'access.denied'


def _uuid(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def _reason(response):
    data = getattr(response, 'data', None)
    if data is None:
        try:
            data = json.loads(response.content or b'{}')
        except (ValueError, TypeError):
            data = None
    detail = data.get('detail') if isinstance(data, dict) else None
    return str(detail)[:300] if detail else ''


def _body_identifiers(request):
    """Champs du corps JSON dont la valeur est un identifiant (ex.
    `work_declaration`, `reserve`) ; rien d'autre du corps n'est gardé."""
    if 'json' not in (request.content_type or ''):
        return {}
    try:
        body = json.loads(request.body or b'{}')
    except (ValueError, TypeError):
        return {}
    if not isinstance(body, dict):
        return {}
    return {key: _uuid(value) for key, value in body.items() if _uuid(value)}


class RefusedAttemptMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Le corps doit être lu avant la vue (il n'est plus lisible après).
        identifiers = _body_identifiers(request) if request.method in WRITE_METHODS and request.path.startswith('/api/') else {}
        response = self.get_response(request)
        if (
            response.status_code in TRACED_STATUSES
            and request.method in WRITE_METHODS
            and request.path.startswith('/api/')
        ):
            self._record(request, response, identifiers)
        return response

    @staticmethod
    def _record(request, response, identifiers):
        user = getattr(request, 'user', None)
        organization = getattr(request, 'organization', None)
        if user is None or not user.is_authenticated or organization is None:
            return
        match = getattr(request, 'resolver_match', None)
        route = match.url_name if match and match.url_name else ''
        targets = {key: _uuid(value) for key, value in (match.kwargs if match else {}).items() if _uuid(value)}
        target = next(iter(targets.values()), None)
        # La vue a pu basculer le contexte RLS sans le restaurer avant son refus.
        set_rls_context(organization_id=organization.id)
        AuditEvent.objects.create(
            organization_id=organization.id,
            actor=user,
            action=ACTION,
            object_type=f'route:{route}' if route else 'route',
            object_id=target or user.pk,
            payload={
                'method': request.method,
                'route': route,
                'status': response.status_code,
                'reason': _reason(response),
                'url_identifiers': targets,
                'body_identifiers': identifiers,
            },
        )
