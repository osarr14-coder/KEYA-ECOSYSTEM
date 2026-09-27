# F-075 — apps/web « À faire » et fiche dossier (direction « Confiance premium »)

Troisième étape de la refonte validée (direction A, voir F-073, F-074).

## Livré

- **Navigation unique** : plus de barre d'onglets en double, la barre latérale suffit
  (`AppShell.onModuleSelect`, URL toujours synchronisée, bouton retour du navigateur conservé).
  Regroupement par métier : « À faire » en tête (compteur), puis **Ventes** (Dossiers clients,
  Virements déclarés, Lots — prix & statut), **Finance** (Comptes & décaissements), **Chantier**
  (Contrôles à affecter), **Programmes** (Programmes, Demandes de programme), **Administration**
  (Utilisateurs, Devis / Appels d'offres, Tarifs, Paliers légaux).
- **« À faire »** (`TodayView`, chemin `/`, écran d'arrivée de toute l'équipe KEYIMMO — remplace
  l'écran « Tâches ») : date du jour, « Vos priorités du jour », chiffres clés cliquables
  (actions en attente, réservations à valider, virements à confirmer, dossiers actifs), file des
  tâches de la boîte personnelle avec **« Ouvrir »** (accès direct à l'écran concerné — une
  réservation à valider ouvre directement son dossier) et « Marquer comme traité », pipeline des
  ventes (bloquées, réservées, concrétisées, expirées/annulées).
- **Dossiers clients** (ex-« Réservations ») : liste en tableau (client, lot, prix figé, état,
  pastille « À valider »), filtre par statut et recherche (client, lot, programme).
- **Fiche dossier** : identité (initiales, client · lot, programme, surface, e-mail, statut),
  chiffres clés (prix figé, organisation, échéance du blocage, validation ADV), bloc « Prochaine
  action » (valider et appeler les frais — bouton or ; refuser avec motif), cartes **Paiements**
  (appels avec pastilles d'état, émission de l'appel suivant en bouton or, encaissements) et
  **Contrat**.
- Le Back-office (recherche d'utilisateurs) devient « Utilisateurs » sous `/back-office`.
- Design system : nouveau composant `KeyFigure` (chiffre clé, cliquable ou non, valeur
  numérique ou textuelle) ; les tableaux ne passent en bloc défilant que sous le seuil mobile
  (en grand écran, ils s'étirent sur toute la largeur de leur carte).

## Tests

- web 270 (dont `TodayView.test.tsx` : file des tâches, correspondance tâche → écran, chiffres et
  pipeline ; `ReservationsView.test.tsx` : liste, recherche, fiche, ouverture directe) ;
  design system 197 ; home 115, build 95, control 74.
- Captures vérifiées pour les comptes de démonstration ADV, Finance et admin.
