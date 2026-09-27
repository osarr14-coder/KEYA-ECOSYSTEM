# F-066 — HOME : catalogue, réservation, contrat (Phase 2)

## Contexte

Pendant client de B-048 (réservation) et B-049 (contrat). CDC V3 R1 §9.2, étapes 1 à 3 :
« Catalogue puis fiche bien », « Dossier et réservation / client — blocage du bien, frais
attendus et prochaine action », « Contrat et calendrier — signature simulée ».
Constat : HOME n'avait **aucun catalogue** ; un client sans bien voyait seulement
« Aucun bien ne vous est encore associé. »

## Livraison en deux parties

- **Partie 1 (avec B-048)** — catalogue et réservations.
- **Partie 2 (avec B-049)** — consultation et signature simulée du contrat.

## Scope — partie 1

- Écran « Acheter un bien » (`ClientSalesView`) :
  - **Mes réservations** : lot, programme, statut, prix figé (XOF), échéance du
    blocage avec son fuseau (« heure d'Abidjan, GMT » — CDC §5 : « l'interface indique
    son fuseau »), prochaine étape en clair, annulation en deux temps (confirmation
    explicite, jamais un `window.confirm`).
  - **Biens disponibles** : programme, bien, localisation, surface, prix, organisation
    porteuse, bouton « Réserver ce bien ». Un refus du serveur (lot pris entre-temps,
    T01) est affiché tel quel.
- **Rôle `client`** : sans bien, il atterrit sur cet écran ; avec un bien, il l'a en
  onglet supplémentaire (il peut acheter un second bien). Même principe que l'onglet
  « Programme sur mesure » du sponsor (F-057). Les autres rôles sans bien gardent le
  message générique.
- Aucun calcul métier côté frontend : disponibilité, échéance et prix viennent du
  serveur ; les montants ne sont que formatés.

## Hors scope

- Frais de réservation et versements : Phase 3 (encaissements simulés). La prochaine
  étape les annonce sans jamais les présenter comme accomplis (CDC §9.2 : « aucun écran
  factice ne doit afficher une opération comme accomplie »).
- Fiche bien détaillée (plans, photos) : aucune donnée de ce type n'existe côté serveur.

## Critères d'acceptation (partie 1)

- Un client sans bien voit le catalogue, réserve un lot, voit son blocage et son
  échéance, peut l'annuler après confirmation.
- Un lot pris entre-temps donne un message explicite, jamais une erreur générique.
- Utilisable à 390 px de large sans défilement horizontal (CDC T20).
- Suite `apps/home` verte ; vérifié dans un vrai navigateur.
