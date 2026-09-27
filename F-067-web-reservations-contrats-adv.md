# F-067 — apps/web : réservations et contrats côté équipe KEYIMMO (Phase 2)

## Contexte

Pendant « équipe KEYIMMO » de B-048 (réservation) et B-049 (contrat). CDC V3 R1 §4 : le
gestionnaire ADV « prépare […] les contrats », « approuve le contenu du contrat fictif
avant signature » ; §6.1 : annulation d'un blocage « par client/gestionnaire ».

## Livraison en deux parties

- **Partie 1 (avec B-048)** — onglet « Réservations ».
- **Partie 2 (avec B-049)** — rédaction, soumission, approbation et historique des
  versions de contrat depuis une réservation.

## Scope — partie 1

- Onglet « Réservations » (`/reservations`, groupe « Ventes & tarification »), visible par
  `admin_keyimmo` et `gestionnaire_adv` (même filtrage par rôle que F-065).
- Liste de toutes les réservations, toutes organisations, filtrable par statut (défaut :
  bloquées) : lot, programme, client, organisation, prix figé, échéance datée avec son
  fuseau, auteur et motif d'une annulation.
- Annulation d'une réservation bloquée avec **motif obligatoire** (bouton inactif sans
  motif, refus du serveur affiché tel quel).

## Critères d'acceptation (partie 1)

- L'admin et l'ADV voient toutes les réservations et annulent une réservation bloquée
  avec motif ; aucune autre action n'est proposée sur une réservation expirée ou
  annulée.
- Suite `apps/web` verte ; vérifié dans un vrai navigateur.
