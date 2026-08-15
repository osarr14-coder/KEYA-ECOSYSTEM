from django.db import connection

USER_SESSION_VAR = 'app.current_user_id'
ORGANIZATION_SESSION_VAR = 'app.current_organization_id'


def _set_local(name, value):
    """Équivalent de `SET LOCAL` : ne vaut que pour la transaction en cours,
    doit donc toujours être appelé à l'intérieur d'un bloc `transaction.atomic()`.
    """
    with connection.cursor() as cursor:
        cursor.execute('SELECT set_config(%s, %s, true)', [name, str(value)])


def set_rls_context(*, user_id=None, organization_id=None):
    if user_id is not None:
        _set_local(USER_SESSION_VAR, user_id)
    if organization_id is not None:
        _set_local(ORGANIZATION_SESSION_VAR, organization_id)
