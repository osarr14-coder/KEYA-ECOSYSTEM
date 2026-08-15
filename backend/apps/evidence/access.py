"""Unique mécanisme d'accès aux fichiers de `Document` — voir
`apps/evidence/views.py::DocumentDownloadView`, seule route qui sert
réellement un fichier. Aucune autre vue ne doit jamais renvoyer `file.url`
ou `thumbnail.url` bruts dans une réponse (ticket 004, critère
d'acceptation sur `sensitivity_level`, appliqué ici à tous les documents
plutôt que cas par cas — plus simple et plus sûr, voir CLAUDE.md).
"""

from django.core import signing

from apps.organizations.models import Membership

from .models import SensitivityLevel

DOWNLOAD_TOKEN_SALT = 'apps.evidence.document-download'
DOWNLOAD_TOKEN_MAX_AGE_SECONDS = 300  # 5 minutes

# Rôles autorisés à accéder à un document confidentiel dont ils ne sont pas
# propriétaires. Volontairement un seul rôle, pas une matrice de
# permissions par rôle × niveau — l'ABAC complet est hors scope (ticket
# 001) ; ceci est la seule règle que le ticket 004 demande explicitement.
CONFIDENTIAL_ACCESS_ROLE_CODES = {'admin_keyimmo'}


def user_can_access_document(user, document, organization):
    """`sensitivity_level` conditionne réellement l'accès, pas seulement
    l'affichage (ticket 004) : au-delà de la vérification organisation +
    authentification déjà appliquée à tout document, un document
    `confidentiel` n'est accessible qu'à son propriétaire ou à un membre
    avec le rôle `admin_keyimmo` de l'organisation active — n'importe quel
    autre membre de la même organisation en est exclu, alors qu'il aurait
    accès à un document `interne`/`public` identique.
    """
    if document.sensitivity_level != SensitivityLevel.CONFIDENTIEL:
        return True
    if document.owner_id == user.id:
        return True
    return Membership.objects.filter(
        user=user, organization=organization, role__code__in=CONFIDENTIAL_ACCESS_ROLE_CODES,
    ).exists()


def _signer():
    return signing.TimestampSigner(salt=DOWNLOAD_TOKEN_SALT)


def generate_download_token(document_id):
    return _signer().sign(str(document_id))


def verify_download_token(token, max_age_seconds=DOWNLOAD_TOKEN_MAX_AGE_SECONDS):
    """Retourne l'UUID (str) du document si le token est valide et non
    expiré. Lève `signing.BadSignature` (dont `signing.SignatureExpired`)
    sinon — à charge de l'appelant de la traduire en réponse HTTP.

    Le token prouve seulement qu'il a été émis par le point d'entrée
    autorisé (`DocumentViewSet.signed_url`) pour ce document précis, il ne
    remplace pas la vérification de permission : celle-ci est revérifiée à
    chaque téléchargement dans `DocumentDownloadView`, indépendamment de la
    validité du token (l'appartenance à l'organisation a pu changer entre
    l'émission du lien et son utilisation).
    """
    return _signer().unsign(token, max_age=max_age_seconds)
