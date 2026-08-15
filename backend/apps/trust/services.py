"""Logique métier au-delà du simple CRUD de `apps/trust/repository.py`."""

from .models import TrustLevel

# Conversion d'un TrustLevel en fraction de progression (0-100) — décision
# d'ingénierie prise au ticket 008 (HOME client), PAS une doctrine
# préexistante au ticket 003 : le produit ne définit nulle part une formule
# de « pourcentage d'avancement » à partir des 5 niveaux Visible Trust. Un
# simple compte de sujets `valide` resterait proche de 0% pour la plupart des
# lots (`TrustLevel.VALIDE` n'est posé que via la levée d'une réserve,
# ticket 005 — jamais sur un jalon inspecté `conforme` sans réserve, qui
# plafonne à `verifie`).
#
# Centralisé ici au ticket 009, quand un second consommateur (`apps/build`)
# en a eu besoin : HOME (`apps/home`) et BUILD (`apps/build`) doivent
# afficher EXACTEMENT le même pourcentage pour un même lot, qu'il soit vu par
# un client ou un constructeur — deux copies de cette formule auraient pu
# diverger silencieusement.
LEVEL_PROGRESS_FRACTION = {
    None: 0,
    TrustLevel.DECLARE: 20,
    TrustLevel.DOCUMENTE: 40,
    TrustLevel.CONTROLE: 60,
    TrustLevel.VERIFIE: 80,
    TrustLevel.VALIDE: 100,
}


def progress_fraction_for_level(level):
    return LEVEL_PROGRESS_FRACTION[level]
