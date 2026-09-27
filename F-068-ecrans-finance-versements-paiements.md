# F-068 — Écrans du flux financier : Finance (apps/web), appels (HOME), paiements reçus (BUILD)

## Contexte

Les backends B-050 (appels de fonds), B-051 (encaissements) et B-052 (décaissements) n'avaient
aucun écran : le rôle `finance` ne pouvait même pas se connecter à une application. Ce ticket
rend le scénario du CDC V3 §9.1 déroulable de bout en bout dans les interfaces (étapes 3 à 8
du parcours §9.2).

## Scope

- **apps/web** — Finance entre dans le back-office (connexion → apps/web, comme l'ADV) et n'y voit
  que ses onglets :
  - « Réservations » (équipe KEYIMMO) : chaque dossier actif porte un **dossier financier** —
    appels de fonds (montant, couvert rapproché, état), émission des prochains appels calculés
    par le serveur (admin/ADV seulement), encaissements avec leurs affectations et leur solde
    non affecté ; Finance enregistre, affecte, rapproche. Annulation et contrat restent
    réservés à l'admin et à l'ADV.
  - « Comptes & décaissements » (équipe KEYIMMO, actions Finance) : solde simulé détaillé par
    programme (encaissements rapprochés, sorties exécutées, réservé, disponible), jalons
    actionnables avec leurs conditions techniques (tous sur demande), décaissements : préparer,
    contrôler l'éligibilité, exécuter (référence + date), annuler (motif), rapprocher — sans
    confirmation, uniquement avec le motif « Confirmation bénéficiaire non reçue », l'absence
    restant affichée.
- **HOME** — le client voit ses appels de fonds et leur couverture ; libellés d'étape pour
  « Réservée » et « Concrétisée ».
- **BUILD** — onglet « Paiements reçus » : sorties exécutées vers l'organisation active,
  confirmation de réception (information, pas preuve bancaire).

Aucune règle métier côté frontend : montants, éligibilité et refus viennent du serveur (409
affichés tels quels). Marquage « SIMULÉ — AUCUN FONDS RÉEL » sur chaque écran financier.

## Vérification

Parcours complet déroulé contre le serveur de développement avec les comptes de
démonstration (B-053) : réservation → contrat approuvé → frais 100 000 rapprochés (Réservée) →
complément 2 900 000 + signature (Concrétisée) → déclaration « Fondations » documentée →
éligibilité refusée avant inspection → avis conforme → éligibilité (1 000 000 réservés) →
exécution (disponible 2 000 000, rejeu idempotent) → confirmation constructeur dans BUILD →
rapprochement Finance dans apps/web.

## Hors scope

- Déclaration de travaux (BUILD) et affectation d'une mission au contrôleur (apps/web) : aucun
  écran n'existe encore — dans la vérification ci-dessus, cette étape est passée par les
  services Django. Livré depuis par B-054/F-069.
- Pièce jointe aux encaissements, contrepassations, remboursements.
