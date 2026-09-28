# Plan en lots après l'audit du parcours R1

| | |
|---|---|
| Décisions | PO-2026-09-28-41 à -48 (`docs/decisions/JOURNAL_DECISIONS.md`) |
| Audit de référence | `docs/audit/AUDIT_PARCOURS_R1.md` (branche `audit/parcours-r1`) |
| Branche de travail proposée | `fix/audit-ui-r1` (suite des étapes 1 à 8) |
| Statut | **Plan proposé, aucun code écrit.** Démarrage d'un lot sur accord du PO. |

Estimations en **jours de travail**. Elles comprennent le code, les tests automatiques, les captures avant/après (375 px et 1440 px) et le compte rendu. Chaque lot suit la méthode des étapes précédentes :

1. inscription au journal et captures avant ;
2. code, puis suites complètes (pytest ; vitest des 5 espaces) ;
3. captures après et compte rendu ;
4. commit et push ;
5. **arrêt pour validation**.

## Vue d'ensemble

| Lot | Frictions visées | Frictions résolues en plus par la même règle | Tests T rendus possibles | Estimation |
|---|---|---|---|---|
| 1 · Cohérence | P19, P22, P28 | P27, P29, P35 ; P33 en partie | T02, T12, T19 (HOME actualisé), T01 (côté affichage) | 3 à 4 j |
| 2 · Relais | P08, P09, P10, P11 | P33 ; P28 (notification) ; P30 en partie | T19, T06, T07, T11 | 3 à 4 j |
| 3 · Connexion | P32 | — | T20 (erreurs compréhensibles), §10 | 0,5 à 1 j |
| 4 · Pilotage minimal | P12 | P17 en partie (chronologie en libellés métier) | T19 (indicateurs), T14 (exclusion des archives, avec le lot 5) | 5 à 6 j |
| 5 · Archivage | P13 | — | T14, T13, T16 (journal intact après archivage) | 10 à 12 j |
| Vérification finale | — | — | T01–T20, dont T02, T14 et T20 complets | 2 j |
| **Total** | | | | **23,5 à 29 j** |

---

## Lot 1 — Cohérence (PO-2026-09-28-43)

**Règle :** un même objet affiche le même état chez tous les rôles, sans rechargement manuel. Toute annulation ou expiration de réservation est visible et expliquée au client (CDC §6.1).

### Constat dans le code

- Les apps ne partagent aucun cache. Le crochet maison `useApiResource` est copié dans `web`, `home` et `build`. Il ne recharge que si ses dépendances changent ou sur appel explicite de `refetch()`.
- Il n'existe ni rafraîchissement au retour sur la fenêtre, ni rafraîchissement périodique, ni invalidation après une action. Seule l'app Contrôle interroge le serveur toutes les 15 s, et seulement pour ses missions.
- **P19** : `ReceiptsLedger` (`apps/web/src/views/PaymentNoticesView.tsx:325`) n'est jamais rechargé après un enregistrement, une affectation ou un rapprochement faits dans le `FinancialFilePanel` voisin.
- **P22** :
  - `reservationMessage()` (`apps/home/src/views/AcquisitionJourney.tsx:34`) renvoie un texte fixe pour l'état « réservé ». Il ignore la signature et les versements.
  - L'échéance du blocage change parce que `validate_reservation` (`backend/apps/sales/services.py:837`) la reporte à `max(échéance, examen + 24 h)`, sans l'afficher.
- **P28** :
  - L'API client renvoie bien les réservations annulées et expirées, avec leur motif. L'écran les range dans un « Historique » secondaire.
  - Aucune date de fin n'est exposée.
  - Aucune tâche en attente (« Dossier à examiner », « Appel de fonds à régler ») n'est fermée à l'annulation ou à l'expiration.

### Travaux

1. **Rafraîchissement commun** (3 apps, même changement, même test) :
   - un bus d'invalidation par app : toute action réussie publie « changé » et toutes les ressources affichées se rechargent (règle P19, P35) ;
   - rechargement au **retour sur la fenêtre** (`visibilitychange` / `focus`) et toutes les **15 s** tant que l'onglet est visible (cohérence entre fenêtres de rôles différents) ;
   - le compteur de la cloche suit la même règle ;
   - pas de SSE ni de websocket : Render sert l'API par gunicorn en WSGI sur un plan gratuit, et ce mécanisme ne s'y prête pas.
2. **Espace client** :
   - un seul message « Suite » calculé depuis l'état réel du contrat et des appels, avec une seule prochaine action à la fois (P22) ;
   - le reste à verser (P27) ;
   - un catalogue rafraîchi après un refus concurrent (P29).
3. **Échéance du blocage** : l'expliquer ou supprimer le report (arbitrage A1 ci-dessous).
4. **Annulation et expiration visibles** :
   - date de fin exposée par l'API (champ `ended_at` ou lecture de l'événement d'audit) ;
   - carte en tête de l'espace client : « Réservation annulée le … par le gestionnaire — motif : … » ou « Blocage expiré le … — le bien est de nouveau disponible, vous pouvez refaire une demande » ;
   - l'auteur s'affiche « organisation · rôle » (PO-2026-09-28-18) ;
   - l'annulation et l'expiration ferment les tâches en attente du dossier.
5. L'expiration reste **paresseuse** (appliquée à la lecture). Elle fonctionne donc sans worker ni tâche planifiée, ce qui convient à Render. Il faut vérifier que chaque écran qui montre une réservation passe par elle.

### Tests

- vitest :
  - bus d'invalidation ;
  - retour de focus et intervalle (horloge simulée) ;
  - relevé et fiche identiques après enregistrement puis rapprochement ;
  - cloche à jour après une action ;
  - messages client selon chaque combinaison contrat/appel.
- pytest :
  - date de fin et motif exposés au seul client concerné (T08) ;
  - tâches fermées à l'annulation et à l'expiration ;
  - tests T02 existants (`apps/sales/tests.py:240`, `:258`) étendus à la fermeture des tâches.

---

## Lot 2 — Relais (PO-2026-09-28-44)

**Règle :** chaque transition crée une entrée « À faire » pour le rôle qui doit agir ensuite et met à jour la cloche. L'entrée disparaît quand l'action est faite.

### Constat dans le code

- Le modèle `Task` (`backend/apps/tasks/models.py`) sert à la fois pour « À faire » et pour la cloche : le compteur est le nombre de tâches en attente.
- L'unicité est assurée sur (objet, source), ce qui rend la création idempotente.
- Le circuit de paiement (`backend/apps/sales/notifications.py`) crée et ferme déjà ses tâches de façon synchrone. C'est le modèle à suivre.
- **Aucune des transitions ci-dessous ne crée de tâche aujourd'hui.** Les tâches « réserve ouverte » et « mission affectée » passent par Celery et ne se ferment qu'à la main.

### Transitions et entrées

| # | Transition | Rôle qui agit | Entrée « À faire » | Fermée quand | Friction |
|---|---|---|---|---|---|
| R1 | Réservation → Réservée (frais rapprochés) | Gestionnaire | « Appeler le complément du premier versement — lot A1 » | Appel du complément émis | P08 |
| R2 | Jalon soumis, resoumis ou « Nouvelle revue nécessaire », sans mission programmée | Gestionnaire | « Affecter le contrôle — lot A1 · Fondations » | Mission affectée | P09 |
| R3 | Jalon accepté techniquement | Finance | « Jalon décaissable — lot A1 · Fondations » | Décaissement exécuté ou jalon à nouveau bloqué | P10 |
| R4 | Dossier concrétisé (COMMITTED) | Constructeur | « Déclarer le jalon Fondations — lot A1 » | Déclaration soumise | P11 |
| R5 | Décaissement exécuté | Constructeur | « Confirmer la réception (facultatif) » | Confirmation ou rapprochement Finance (T11 : l'absence de confirmation reste visible) | P11 |
| R6 | Réserve ouverte (existe) | Constructeur | inchangée | **Fermeture automatique** à la proposition de correction | P33 |
| R7 | Mission affectée (existe) | Contrôleur | inchangée | **Fermeture automatique** à l'avis | P33 |
| R8 | Appel réglé par le flux Finance direct | Client | « Appel de fonds à régler » | **Fermeture** dès que l'appel est soldé, quel que soit le chemin | P33 |
| R9 | Réservation annulée ou expirée | Client | Notification « Réservation annulée / blocage expiré » | Marquée vue | P28 |

### Travaux

- Service de relais synchrone, dans la même transaction que la transition (CDC §10, atomicité).
- Libellés déclarés dans `LABEL_GENERATORS` : le test de garde existant les vérifie.
- Chaque entrée ouvre l'écran de l'action (`taskTarget`). Les confirmations d'action disent désormais qui agit ensuite (P30), en réutilisant le libellé « Qui agit » du serveur.
- Les états de jalon sont calculés et non stockés. Les points d'accroche sont donc les services de déclaration, de correction, de remplacement de pièce (T07) et d'avis.

### Tests

- pytest, pour chacune des transitions R1 à R9 :
  - une seule entrée, pour le bon rôle et le bon périmètre (RLS) ;
  - pas de doublon en cas de répétition ;
  - fermeture à l'action ;
  - compteur de la cloche.
- vitest : entrée cliquable jusqu'à l'action ; la cloche diminue après l'action (lien avec le lot 1).

---

## Lot 3 — Connexion (PO-2026-09-28-45)

### Constat dans le code

- La limite est de 5 par minute par adresse IP (`ScopedRateThrottle`, portée `login`). Réponse : 429 avec `detail` et en-tête `Retry-After`.
- Cet en-tête n'est pas lisible par l'app web : il manque dans `CORS_EXPOSE_HEADERS`.
- L'écran `apps/web/src/App.tsx:416` affiche « Une erreur est survenue » pour toute erreur autre que 401.

### Travaux

- Serveur : le corps de la réponse 429 porte un `code` et un délai `retry_after` en secondes. `Retry-After` est ajouté aux en-têtes exposés.
- Écran :
  - « Trop de tentatives de connexion depuis ce poste. Réessayez dans 42 s. » ;
  - décompte annoncé (`aria-live`) ;
  - bouton désactivé jusqu'à l'échéance, puis réactivé ;
  - les autres erreurs sont distinguées : réseau, serveur indisponible, identifiants.
- Script de démonstration : ouvrir les fenêtres de rôle en plusieurs fois. Avec 7 comptes, les 7 connexions dépassent 5 par minute (arbitrage A5). Les jetons durent 1 h et se renouvellent pendant 7 jours : une fenêtre ouverte tient toute la démonstration.

### Tests

- pytest (limitation activée localement dans le test) : 429 avec `code` et `retry_after` ; en-tête exposé.
- vitest : message, décompte, réactivation, autres erreurs.

---

## Lot 4 — Pilotage minimal (PO-2026-09-28-46)

### Constat dans le code

- `Indicator` gère déjà le numérateur, le dénominateur et « Non applicable ». `Timeline` gère l'acteur, le rôle, l'action, la date, le motif et l'objet.
- Ces deux composants ne sont utilisés que dans la galerie. Il n'existe **aucun endpoint d'indicateurs et aucun écran de pilotage**.
- Deux journaux coexistent :
  - `AuditEvent` : réservation, contrat, appels, encaissements, avis de paiement, décaissements ;
  - `TrustEvent` : chaîne chantier.
- Le seul point d'accès est `/api/admin/journal/` (administrateur, 200 derniers événements, sans filtre par objet).
- **Les pièces exigées par jalon ne sont définies nulle part** : il n'existe pas de champ sur `MilestoneTemplateStep`.

### Indicateurs (§9.3, instance active seulement)

| Indicateur | Numérateur / dénominateur | Sources cliquables |
|---|---|---|
| Jalons examinés | Jalons soumis ayant au moins un avis / jalons soumis. Les acceptations techniques courantes sont affichées à part. | Liste des jalons avec état et dernier avis |
| Paiements rapprochés | **Deux indicateurs** : entrées rapprochées / entrées exécutées ; sorties rapprochées / sorties exécutées | Mouvements, dans le périmètre du rôle (arbitrage A3) |
| Réserves | Ouvertes et levées (comptes), ancienneté calculée depuis la date serveur d'ouverture | Liste des réserves avec leur ancienneté |
| Pièces | Pièces exigées déposées / pièces exigées selon le scénario, **sans assimiler présence et conformité** | Liste des pièces par jalon |

Dénominateur nul : « Non applicable », jamais 100 %.

### Travaux

- **Serveur** :
  - `GET /api/pilotage/indicateurs/` et la liste des sources de chaque indicateur, pour le gestionnaire, avec droits vérifiés côté serveur (le détail n'élargit pas les droits, §9.3) ;
  - `GET /api/dossiers/<id>/chronologie/` fusionne `AuditEvent` et `TrustEvent` du dossier et de son lot, ordonnés par date serveur ;
  - libellés métier (P17 en partie), personnes affichées « organisation · rôle ».
- **Pièces exigées** : paramètre versionné par étape de jalon dans le Country Pack (T18), plus sa migration et le jeu `DEMO-CI-v1`. C'est ce qui rend l'indicateur calculable (arbitrage A4).
- **Design system** : variante « comptes » d'`Indicator` pour les réserves (ouvertes, levées, ancienneté), ajoutée à la galerie.
- **Back-office** : onglet « Pilotage » du gestionnaire (4 indicateurs, sources, 1440 px) et chronologie dans la fiche dossier (`Timeline`).

### Tests

- pytest :
  - chaque indicateur sur un jeu construit, cas « Non applicable » compris ;
  - droits sur les sources ;
  - chronologie complète et ordonnée ;
  - aucun e-mail dans la chronologie ;
  - aucune donnée d'une autre organisation.
- vitest : écran, clic vers les sources, chronologie.

---

## Lot 5 — Archivage (PO-2026-09-28-47, révise PO-2026-09-28-25)

Base : `docs/demo/ARCHIVE_INSTANCE_PROPOSITION.md`, estimée à 9 à 11 jours, sans changement de principe.

### Rappel de la proposition

- en-tête `X-Demo-Instance-View` contrôlé selon le rôle ;
- `demo_scope()` paramétré (14 appels) ;
- garde-fou d'écriture `ensure_writable` sur les **environ 69 routes d'écriture**, avec un test de garde qui les parcourt toutes ;
- `ArchiveBanner` et actions désactivées avec leur explication ;
- indicateurs de l'instance active non contaminés.

### Ajout nécessaire à l'étape 11

L'étape 11 demande l'archivage **dans l'écran Administration**. La proposition ne couvre que la consultation. Il faut donc ajouter :

- une action administrateur « Archiver l'instance et en créer une nouvelle », avec confirmation saisie ;
- une route authentifiée, jamais publique (§10) ;
- le jeu initial versionné rejoué, sans objet lié à l'ancienne instance ;
- un journal de l'opération.

Cet ajout est estimé à **+1 à 1,5 j**. La procédure T14 (`PROCEDURE_REINITIALISATION_DEMO.md`) est à mettre à jour : l'archivage devient la voie normale et la réinitialisation complète reste un recours d'exploitation.

### Tests

- pytest :
  - aucune écriture sur une archive, sur toutes les routes ;
  - consultation par rôle, en particulier le client qui ne voit que ses dossiers ;
  - indicateurs actifs à « Non applicable » après archivage ;
  - journal intact (T16) ;
  - identité d'instance sur les écrans, l'API et les exports (T13).
- vitest : bandeau, actions désactivées et retour à l'instance active dans les 4 apps.

---

## Plan de vérification

Après chaque lot : suites complètes, captures avant/après, et **rejeu Playwright** des étapes concernées, par l'interface seule avec l'outillage de l'audit.

Après le lot 5 : rejeu complet des trois parcours de l'audit (principal, alternatif, erreurs) et fiche T01–T20 (version, résultat, preuve, relecteur).

| Test | État à l'audit | Vérification prévue |
|---|---|---|
| **T02** | NOT_TESTED (échéance de 24 h non atteinte pendant l'audit) | pytest avec horloge simulée (existant, étendu au lot 1). Par l'interface : instance locale avec la durée de blocage réduite à **1 h** (le réglage est un entier en heures), puis attente réelle de l'échéance pendant le reste du parcours. On vérifie que le bien est libéré, que l'événement est visible chez le client et le gestionnaire, et qu'une nouvelle demande est possible. **Réglage local soumis à votre accord** (PO-2026-09-28-41). |
| **T14** | Partiel (réinitialisation hors application, pas d'archive consultable) | Parcours complet, puis archivage depuis l'écran Administration. On vérifie : nouvelle instance vierge ; archive consultable en lecture seule par chaque rôle ; écritures refusées ; indicateurs actifs à « Non applicable ». |
| **T20** | Partiel (réservation au clavier seulement) | Au clavier seul, parcours client complet (réservation, signature, avis de paiement, suivi) et parcours constructeur (déclaration, pièce, correction, confirmation de réception) à 375 px. On vérifie : focus visible, ordre logique, erreurs annoncées, aucun débordement horizontal. P31 (action principale sous la ligne de flottaison) ne bloque pas T20 : l'action reste atteignable. Il reste une friction P2, hors lots. |
| T19 | Étapes 10 et 11 absentes | Rejeu des deux parcours sans intervention en base, étapes 1 à 11. |
| T01, T05, T08, T09, T11, T12 | Vérifiés à l'audit | Rejeu pour s'assurer qu'aucune régression n'apparaît. |
| T03, T04, T06, T07, T10, T13, T15 à T18 | Couverts par pytest, non rejoués par l'interface | Fiche T avec la preuve automatisée ; T13 et T16 rejoués après le lot 5. |

**Limite :** la vérification est faite par la même session que le code. La revue indépendante exigée par le CDC §11 reste à organiser (autre session ou autre relecteur) avant la réception.

## Hors lots — plan de déploiement Render (PO-2026-09-28-48)

P01 à P06, à intégrer au plan de déploiement, qui reste soumis à votre accord :

- **P01** : README à la racine.
- **P02** : commande du worker Celery et son rôle. Sur Render, `CELERY_TASK_ALWAYS_EAGER=True` : l'expiration paresseuse du lot 1 ne dépend d'aucun worker.
- **P04** : une seule valeur de port Postgres par mode.
- **P05** : `--dry-run` qui signale une migration en attente au lieu de planter.
- **P06** : prérequis de la procédure cohérent avec `--confirm` et statut à jour.
- Sauvegarde préalable de la base Render avant la réinitialisation (décision déjà notée).

P03 et P07 (P2) peuvent suivre dans le même lot documentaire.

## Arbitrages demandés avant de démarrer

| # | Lot | Question | Proposition |
|---|---|---|---|
| A1 | 1 | L'échéance du blocage est reportée à l'examen du dossier (+24 h). Faut-il garder ce report ? | Le garder et l'afficher : « Échéance reportée au … lors de l'examen du dossier ». Le supprimer changerait une règle testée (B-056). |
| A2 | 1 | Rafraîchissement au retour sur la fenêtre et toutes les 15 s : cette cadence convient-elle ? | Oui. En démonstration, le changement de fenêtre déclenche le rechargement immédiat. |
| A3 | 4 | Le détail des sorties (décaissements) est réservé à Finance (PO-2026-09-28-16). Le gestionnaire voit-il ces sources ? | Le gestionnaire voit le chiffre, sans détail : « Détail réservé à Finance ». Finance voit le détail. |
| A4 | 4 | Les pièces exigées par jalon n'existent pas dans le jeu de démonstration. | Les ajouter comme paramètre versionné du Country Pack et du jeu `DEMO-CI-v1`, avec les pièces à définir par vous. **À confirmer : ajout au jeu de démonstration.** |
| A5 | 3 | La limite par IP s'applique à toutes les tentatives, réussies comprises. Ouvrir 7 fenêtres en moins d'une minute la dépasse. | Garder la règle et échelonner les connexions dans le script de démonstration. Autre option : ne compter que les échecs (changement de la règle §10, à votre arbitrage). |
| A6 | 5 | Points ouverts de la proposition d'archive (§5) : un client voit-il ses dossiers archivés ? Quelle rétention et quel responsable ? Archivage ou réinitialisation comme voie normale ? | Instance active par défaut et archive sur demande ; archivage comme voie normale ; rétention et responsable à fixer par vous avant l'hébergement (§10). |
| A7 | — | Vérification de T02 par l'interface avec une durée de blocage de 1 h sur l'instance locale | Réglage local le temps de la vérification, puis retour à 24 h. |
