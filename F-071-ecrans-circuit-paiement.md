# F-071 — Écrans du circuit de paiement (ADV, client, Finance) et cloches

Backend : B-056. Décisions utilisateur : l'ADV valide la réservation et émet l'appel ; le client
est notifié et paie ; Finance confirme la réception ; l'ADV est informé.

## Scope

- **apps/web — Réservations (ADV/admin)** : « Validation ADV » affichée sur chaque dossier ;
  bouton « Valider la réservation et appeler les frais » (réservation bloquée, non validée).
  Refuser = annuler avec motif (existant).
- **apps/web — onglet « Virements déclarés »** (équipe KEYIMMO, actions Finance) : avis du client
  (montant, référence, date, appel, état de la réservation) ; « Confirmer la réception »
  (référence du relevé si différente, date de réception) ou « Rejeter » (motif obligatoire).
- **apps/web — cloche et onglet « Tâches » pour toute l'équipe** (admin, ADV, Finance) : boîte
  personnelle transverse (`/api/me/tasks/inbox/`), remplace la boîte admin.
- **HOME — client** : étape « en attente de validation par votre conseiller KEYIMMO » puis
  « Réglez les frais… » ; pour chaque appel non couvert, instructions de virement (compte
  FICTIF, référence `KEYA-…`) et « J'ai effectué le virement » ; état de la déclaration (en
  attente de confirmation, rejetée avec motif → nouvelle déclaration possible). Cloche et
  « Mes actions » sur la boîte transverse (les notifications de vente vivent dans l'organisation
  du lot).

## Vérification

Déroulé dans les vrais écrans (serveur local, comptes de démonstration) : client2 réserve le
Lot A2 → l'ADV voit « Réservation à valider » et valide → le client voit les instructions et
déclare son virement → Finance confirme dans « Virements déclarés » → l'ADV reçoit « Paiement
reçu … réservation : Réservée », le client voit sa réservation « Réservée ».
