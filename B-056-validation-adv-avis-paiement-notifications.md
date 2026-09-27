# B-056 — Validation ADV, avis de paiement du client, confirmation Finance, notifications

## Contexte

Retour utilisateur après tests sur Render : « on ne sait pas qui valide la réservation du client,
le client ne fait aucune action de paiement et KEYA ne reçoit pas de paiement ». Décisions de
l'utilisateur (propriétaire du produit) :

- l'**ADV valide** effectivement la réservation et **émet l'appel de fonds** ;
- le **client est notifié** et **paie** (déclare son virement) ;
- **Finance confirme** la réception ; l'ADV est alors informé.

## Circuit

| Étape | Acteur | Effet | Notification (cloche) |
|---|---|---|---|
| Réservation | client | lot bloqué (HELD) | ADV : « Réservation à valider » |
| Validation | ADV (ou admin) | réservation validée ; appel « Frais » émis dans la même transaction ; délai de paiement relancé (`RESERVATION_HOLD_HOURS` à compter de la validation) | client : « Appel de fonds à régler » |
| Refus | ADV (ou admin) | annulation motivée existante | — |
| Autres appels | ADV (ou admin) | complément, paliers (inchangé) | client : « Appel de fonds à régler » |
| Avis de paiement | client | `PaymentNotice` déclarée (référence de son virement, date, montant = reste à couvrir) ; expiration du blocage suspendue | Finance : « Virement déclaré à confirmer » |
| Confirmation | Finance | encaissement créé à partir de l'avis, affecté à l'appel, rapproché → transitions automatiques (Réservée, Concrétisée) | ADV et client : « Paiement reçu » |
| Rejet | Finance (motif obligatoire) | avis rejeté ; le client peut déclarer à nouveau | client : « Virement non reçu — motif » |

Les instructions de virement affichées au client (compte bancaire FICTIF, référence à indiquer
`KEYA-XXXXXXXX` propre à chaque appel) sont des données de démonstration.

## Règles

- Un avis de paiement est une **déclaration du client**, jamais une preuve bancaire : il ne couvre
  aucun appel et ne fait avancer aucune réservation. Seul l'encaissement confirmé et rapproché par
  Finance compte (principe du CDC §8.1 conservé).
- Un seul avis en attente par appel ; la même déclaration rejouée (même référence) renvoie l'avis
  existant (idempotence).
- Les notifications réutilisent la boîte de tâches existante (ticket 006) ; une tâche par
  destinataire. Les tâches d'action se ferment d'elles-mêmes quand l'action est faite
  (validation, paiement confirmé, avis traité).
- Nouvelle boîte transverse `GET /api/me/tasks/inbox/` (toutes organisations, `assignee = moi`,
  même boucle que les boîtes admin/inspecteur) : les tâches de vente vivent dans l'organisation du
  lot, jamais dans celle du client ou de l'équipe KEYIMMO.

## Écarts au CDC V3 (décision utilisateur)

- CDC §6.1 : aucune validation humaine entre HELD et RESERVED. Désormais l'ADV valide la
  réservation avant tout appel de fonds ; HELD → RESERVED reste automatique à l'encaissement des
  frais.
- CDC §6.1 : délai de blocage de 24 h. Il est relancé à la validation (le client doit disposer du
  délai complet pour payer après l'appel).
- CDC §8.1 : le client ne faisait aucune action. Il déclare désormais son virement ; Finance reste
  seul à enregistrer l'encaissement.

## Critères d'acceptation

- Frais non émissibles avant validation ; validation = appel « Frais » émis ; validation
  impossible deux fois, ni sur une réservation expirée/annulée.
- Client : instructions de paiement, déclaration, avis visible « en attente de confirmation ».
- Finance : liste des avis en attente, confirmation (encaissement + affectation + rapprochement,
  réservation « Réservée » après les frais), rejet motivé.
- Notifications ADV / client / Finance créées et fermées aux bons moments.
- Un client ne déclare jamais sur l'appel d'un autre client ; seul Finance confirme ; suite verte.
