# F-074 — HOME « Mon acquisition » (direction « Confiance premium »)

Deuxième étape de la refonte validée (direction A, voir F-073). Objectif : un client non
spécialiste comprend en un coup d'œil où en est son achat et ce qu'on attend de lui.

## Livré

- **Navigation unique** : les onglets HOME (`TabBar`) deviennent les entrées de la barre
  latérale (`AppShell.onModuleSelect`) — « Mon acquisition » (client), « Vue d'ensemble » et
  « Avancement & preuves » (propriétaire d'un bien), « Mes actions » (toujours visible, avec
  compteur), « Programme sur mesure » (sponsor) ; les autres espaces (BUILD, CONTROL…) regroupés
  sous « Autres espaces ». La cloche ouvre « Mes actions ».
- **Mon acquisition** (`ClientSalesView` + nouveau `AcquisitionJourney`), par réservation active :
  - bandeau « Mon bien » navy (programme, lot, surface, promoteur, prix, statut, mention
    « Simulation — aucun fonds réel ») ;
  - les **6 étapes** (Réservation, Validation KEYIMMO, Frais, Signature du contrat, Premier
    versement, Suivi du chantier), dérivées des états serveur (`acquisitionSteps`) ;
  - **une seule prochaine action** (`nextAction`) : signer un contrat approuvé, sinon payer un
    appel émis (instructions de virement + « J'ai effectué le virement » en bouton or), sinon
    « virement en vérification », sinon l'attente expliquée (validation, contrat en
    préparation…) ;
  - **Suivi financier** : total réglé / prix, barre or, chaque appel avec sa pastille (À payer,
    En vérification, Partiellement couvert, Couvert) ;
  - carte « Votre conseiller KEYIMMO », contrat (« Mon contrat »), annulation (bloquée
    seulement) ;
  - catalogue en grille de cartes, réservations closes dans un « Historique ».
- Appels de fonds et contrat deviennent présentationnels (`CallRow`, `ContractVersions`) :
  chargés une seule fois par le parcours, qui en dérive étapes et action.
- Design system : nouveau composant `Stepper` (état dit en texte et par la forme, jamais par la
  couleur seule).

## Tests

- HOME 115 (dont `AcquisitionJourney.test.tsx` : étapes, priorité des actions, rendu, totaux) ;
  design system 194 ; web 263, build 95, control 74.
- Captures vérifiées (clair, sombre, mobile 390 px) avec les comptes de démonstration
  client1 (acquisition concrétisée) et client2 (réservée, contrat en préparation).
