# B-057 — Vitrine publique anonyme (API de la page d'accueil F-079)

Deux lectures **anonymes, en lecture seule, à débit limité** (`public`, 60/min), sans
authentification (un jeton invalide ne bloque jamais la vitrine) :

- `GET /api/public/offer/` — programmes ayant au moins un lot avec prix : nom, promoteur,
  localisations, lots **disponibles** (nom, bâtiment, surface, prix), `total_lots`,
  `available_lots` (0 = programme complet, toujours affiché), `price_from`, et le **barème de
  paiement** du Country Pack (frais de réservation + paliers légaux cumulés) pour le simulateur.
- `GET /api/public/worksites/` — chantiers en cours (lots ayant au moins une déclaration de
  travaux) : programme, lot, localisation, état de contrôle de chaque jalon (dérivé par
  `milestone_control_state`, B-054), nombre de jalons acceptés.

Aucune donnée personnelle : ni client, ni réservation, ni pièce, ni montant encaissé.

**RLS** : une requête anonyme n'ouvre aucune transaction dans le middleware ; `apps/sales/public.py`
ouvre la sienne (`SET LOCAL` n'agit que dans une transaction) et bascule d'organisation en
organisation. Contrairement au catalogue authentifié, **aucune écriture** (les blocages échus ne
sont pas libérés par une lecture anonyme).

Tests : `apps/sales/test_public_b057.py` (offre groupée et barème, programme complet, aucune
donnée personnelle, aucune écriture, jeton invalide sans effet, débit limité, chantiers sans
donnée client) ; garde des routes (`apps/procurement/tests.py`) mise à jour.
