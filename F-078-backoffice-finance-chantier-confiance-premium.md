# F-078 — Back-office : Virements déclarés, Comptes & décaissements, Contrôles à affecter

Suite de la refonte « Confiance premium » (F-073 à F-076) : les trois écrans du parcours de
démonstration encore à l'ancien gabarit.

## Livré

- **Virements déclarés** : en-tête (Ventes · Finance), filtre dans l'en-tête, chiffres clés
  « À confirmer » et « Montant à vérifier », montant déclaré en grand, état en pastille (à
  confirmer / confirmé / rejeté), détails en libellés atténués, **« Confirmer la réception » en
  bouton or**, rejet avec motif en dessous.
- **Comptes & décaissements** : en-tête (Finance), solde du programme en quatre chiffres clés
  (encaissements rapprochés, sorties exécutées, réservé, disponible), conditions techniques des
  jalons en pastille (« Réunies » / « Bloqué » + motif), états de demande et de preuve en
  pastilles, **« Exécuter (simulé) » et « Rapprocher » en bouton or**.
- **Contrôles à affecter** : en-tête (Chantier), chiffres clés « À missionner », « Missions en
  cours », « Sous réserve », état en pastille (réserve en rouge), mission en cours mise en
  évidence, **« Missionner » en bouton or**.

## Tests

- web 272 (dont chiffres clés des virements et des contrôles) ; comportements existants
  inchangés (confirmation, rejet, décaissement, affectation).
- Captures vérifiées avec les comptes Finance et admin.
