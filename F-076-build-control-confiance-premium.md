# F-076 — BUILD et CONTROL (direction « Confiance premium »)

Quatrième et dernière étape de la refonte validée (direction A, voir F-073 à F-075).

## BUILD (constructeur)

- **Navigation unique** : les onglets deviennent les entrées de la barre latérale — « À traiter »
  (ex-Exceptions, vue par défaut conservée), « Tous les lots », « Chantiers & jalons »,
  « Paiements reçus », « Tâches » (compteur) ; « Accueil » (HOME) et les autres espaces
  regroupés sous « Autres espaces ».
- **Chantiers & jalons** : en-tête (programme, « Lot — suivi des jalons », choix du lot), bandeau
  d'avancement (un repère coloré par jalon, cliquable), fiche du jalon sélectionné avec son
  **niveau de confiance** (Déclaré → Documenté → Contrôlé → Validé, via `Stepper`) et l'action
  attendue (déclarer en bouton or, joindre une pièce, proposer une correction), encarts
  « Avancement » (jalons acceptés) et « Prochain jalon à déclarer ». Le jalon mis en avant par
  défaut est celui qui attend le constructeur (réserve à corriger, pièce manquante), sinon le
  contrôle en cours, sinon le prochain à déclarer (`focusMilestone`).
- **Paiements reçus** : carte navy pour un paiement à confirmer (montant en grand, bouton or
  « Confirmer la réception »), carte blanche avec pastille pour un paiement confirmé.
- En-têtes de page sur « À traiter », « Tous les lots » et « Tâches ».

## CONTROL (contrôleur, mobile)

- Bandeau de marque épuré (logo or, ombre), missions en cartes avec repère de couleur et pastille
  « Première inspection » / « Mission de suivi — Réserve ».
- Fiche mission : cartes blanches sur ivoire, checklist en lignes tactiles de 48 px, **tuile
  « + Ajouter une photo »** à la place du champ fichier natif, avis en **deux grandes tuiles**
  (Conforme / Réserve, remplies quand choisies), explication de l'envoi différé.
- Design system : règle `.keya-file-drop` (focus clavier visible sur la tuile de dépôt).

## Tests

- BUILD 98 (dont priorité du jalon mis en avant, niveau de confiance, bandeau cliquable) ;
  CONTROL 74 ; design system 197 ; web 270 ; home 115.
- Captures vérifiées : BUILD (À traiter, Chantiers & jalons, Paiements reçus) et CONTROL
  (missions, fiche mission, 390 px) avec les comptes de démonstration.
