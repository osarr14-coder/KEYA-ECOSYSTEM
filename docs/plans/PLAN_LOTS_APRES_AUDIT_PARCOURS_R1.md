# Plan en lots après l'audit du parcours R1

| | |
|---|---|
| Décisions | PO-2026-09-28-41 à -48 (`docs/decisions/JOURNAL_DECISIONS.md`) |
| Audit de référence | `docs/audit/AUDIT_PARCOURS_R1.md` (branche `audit/parcours-r1`) |
| Branche de travail proposée | `fix/audit-ui-r1` (suite des étapes 1 à 8) |
| Statut | **Plan validé** (PO-2026-09-28-49). Ordre : lots 1, 2, 3 (jalon « démo présentable »), répétition de démonstration, lot 4, lot 5 ; arrêt pour relecture après chaque lot. Arbitrages A1 à A7 rendus (PO-2026-09-28-50 à -56). |

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
| 5 · Archivage | P13 | — | T14, T13, T16 (journal intact après archivage) | 8 à 10 j (réestimé, A6) |
| Vérification finale | — | — | T01–T20, dont T02, T14 et T20 complets | 2 j |
| **Total** | | | | **21,5 à 27 j** |

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
3. **Échéance du blocage** : le report à l'examen du dossier est retiré (A1, PO-2026-09-28-50) ; l'échéance affichée reste celle de la demande, suspendue seulement après un encaissement enregistré.
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
- Script de démonstration : ouvrir les fenêtres de rôle en plusieurs fois. Avec 7 comptes, les 7 connexions dépassent 5 par minute (arbitrage A5). Correction (lot 3) : le jeton d'accès dure 1 h et les applications ne le renouvellent pas automatiquement ; une fenêtre ouverte moins de 30 minutes avant tient une démonstration de 15 minutes (procédure : `docs/demo/PROCEDURE_DEMONSTRATION.md`).

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

### Réalisation (arbitrages délégués PO-2026-09-28-63 à -67)

- Pièces exigées : `required_pieces` sur l'étape du modèle de jalons (Country Pack), recopié sur le jalon à la création du lot ; jeu **`DEMO-CI-v2`** (modèle CI v2) ; le constructeur désigne la pièce au dépôt (BUILD).
- Serveur : `apps/pilotage` — `GET /api/pilotage/indicateurs/`, `GET /api/pilotage/indicateurs/<clé>/sources/`, `GET /api/dossiers/<id>/chronologie/` (gestionnaire) ; libellés métier aussi dans le journal de l'administrateur.
- Écrans : onglet « Pilotage » (4 indicateurs, 5 chiffres, sources cliquables vers le dossier) ; carte « Chronologie » de la fiche dossier ; `CountIndicator` (variante « comptes ») dans la galerie.

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

### Réestimation après l'arbitrage A6 (PO-2026-09-28-55)

Accès aux archives en lecture seule pour l'**administrateur** et le **gestionnaire** seulement : pas d'accès client dans le MVP. Responsable : Product Owner. Rétention : jusqu'à 90 jours après la fin de la campagne investisseurs, puis suppression tracée.

| Poste | Contenu | Effort |
|---|---|---|
| Serveur | Paramètre d'instance réservé à ces deux rôles (refusé à tous les autres), `demo_scope` paramétré, garde-fou d'écriture sur toutes les routes | 3 à 3,5 j |
| Tests serveur | Aucune écriture sur une archive (toutes routes), droits des deux rôles, refus aux autres, indicateurs exclus | 1,5 j |
| Front | `apps/web` seulement : sélecteur d'instance, `ArchiveBanner`, actions désactivées avec explication. HOME, BUILD et Contrôle restent sur l'instance active. | 1 à 1,5 j |
| Action d'archivage (étape 11) | Écran Administration, confirmation saisie, route authentifiée, jeu versionné rejoué, journal | 1 à 1,5 j |
| Rétention | Date de fin de campagne en paramètre ; commande de suppression des archives échues, tracée au journal ; procédure | 0,5 à 1 j |
| Captures, documentation, recette | Procédure T14 mise à jour | 1 j |
| **Total** | | **8 à 10 j** |

### Réalisation (arbitrages délégués PO-2026-09-29-01 à -04)

- Serveur : en-tête `X-Demo-Instance-View` (administrateur, gestionnaire ; 403 sinon), `demo_scope` sur l'instance consultée ; garde d'écriture double (requête 409 + modèles, `apps/core/archive.py`) ; lectures qui écrivaient (expiration, éligibilité caduque) figées dans une archive ; client limité à l'instance active ; tâches d'une archive hors des boîtes.
- Étape 11 : `POST /api/admin/instances/archive/` (confirmation par code), jeu versionné rejoué sans toucher aux comptes, journal ; `GET /api/admin/instances/` ; commande `archive_demo_instance` sur le même service.
- Rétention : `DEMO_CAMPAIGN_END`, `check_archive_retention [--record]` ; suppression non automatisée (PO-2026-09-29-04).
- Back-office : écran « Instances et archives », `ArchiveBanner` (code, date, retour), dossiers en lecture seule avec explication, écritures refusées par le client API.

### Tests

- pytest :
  - aucune écriture sur une archive, sur toutes les routes ;
  - consultation par rôle (A6 : administrateur et gestionnaire seulement ; le client ne voit plus ses dossiers archivés) ;
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

## Arbitrages rendus (PO-2026-09-28-50 à -56)

| # | Décision | Journal |
|---|---|---|
| A1 | Aucun report du blocage à l'examen du dossier. Blocage de 24 h, suspendu uniquement après l'enregistrement d'un encaissement simulé (§6.1). Le report existant est retiré, tests adaptés. | PO-2026-09-28-50 |
| A2 | Rafraîchissement immédiat après chaque action, au retour sur la fenêtre et toutes les 15 s ; la cloche aussi. | PO-2026-09-28-51 |
| A3 | Le gestionnaire voit le total des décaissements, sans le détail réservé à Finance. | PO-2026-09-28-52 |
| A4 | Pièces exigées fictives : Fondations (plan d'implantation, photo des fouilles, photo des armatures avant coulage, bon de livraison du béton) ; Élévation (photo de chaque niveau, photo des chaînages, relevé de conformité aux plans). | PO-2026-09-28-53 |
| A5 | Règle conservée ; procédure de démo : une fenêtre par rôle, à 15 s d'intervalle, avant la présentation. | PO-2026-09-28-54 |
| A6 | Archives : responsable PO ; lecture seule administrateur et gestionnaire ; pas de clients ; rétention 90 jours après la campagne, puis suppression tracée. Lot 5 réestimé à 8 à 10 j. | PO-2026-09-28-55 |
| A7 | Blocage d'1 h sur l'instance locale uniquement pour vérifier T02, puis 24 h ; jamais sur Render. | PO-2026-09-28-56 |
