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

## Scope — partie 2 (contrat, avec B-049)

- Panneau « Contrat » dans chaque carte de réservation (`AdminContractPanel`) :
  historique complet des versions (plus récente d'abord), y compris pour une réservation
  expirée ou annulée (lecture seule).
- Rédaction d'un premier brouillon ; brouillon modifiable et soumis pour revue ; version
  en revue approuvée ou renvoyée en brouillon — jamais modifiée.
- **Nouvelle version repliée derrière un bouton explicite** (« Corriger : créer une
  nouvelle version »), pré-remplie avec la précédente, et avertissement si la version
  précédente attend une signature (elle ne serait plus signable). Constat fait en
  vérifiant l'écran dans un navigateur : un formulaire pré-rempli affiché en permanence
  au-dessus d'une version en attente de signature invitait à la rendre non signable par
  erreur.
- Une version approuvée remplacée est signalée « n'est plus signable ».
- Même marquage de simulation que HOME.

## Critères d'acceptation (partie 2)

- L'ADV mène un contrat de la rédaction à l'approbation ; la signature reste au client ;
  une correction après signature crée une nouvelle version, l'ancienne restant visible.
- Vérifié dans un vrai navigateur, de bout en bout avec HOME (F-066).
