"""Aides de test de l'analyse des dépôts (PO-2026-09-29-13, T15). Jamais
référencé par config/settings.py."""

# Fichier de test antivirus standard (EICAR), reconstitué pour ne pas figurer
# tel quel dans le dépôt de code.
EICAR = ('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-' + 'TEST-FILE!$H+H*').encode()
EICAR_SIGNATURE = 'Keya.Test.EICAR'


def eicar_only_scan(data):
    """Moteur de test : détecte le seul fichier EICAR, où qu'il soit."""
    return EICAR_SIGNATURE if EICAR in data else None
