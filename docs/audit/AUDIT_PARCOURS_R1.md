# KEYIMMO AFRIC — Audit du parcours utilisateur R1 (MVP démo)

| Champ | Valeur |
|---|---|
| Date | 28 septembre 2026 (GMT, Abidjan) |
| Version auditée | Branche `fix/audit-ui-r1`, commit `358c950` (aucune modification de code) |
| Référentiel | CDC R1 (`docs/cdc/KEYIMMO_AFRIC_CDC_V3_MVP_REVISION_R1.md`), journal des décisions (`docs/decisions/JOURNAL_DECISIONS.md`), design system (`docs/design/DESIGN_SYSTEM.md`), références visuelles (`docs/design/references/`), audit UI R1 (`docs/audits/AUDIT_UI_KEYIMMO_AFRIC_R1.md`) |
| Environnement | Pile locale démarrée à partir du dépôt seul, base neuve par `scripts/reset_demo_local.sh` (jeu `DEMO-CI-v1`) : instance `DEMO-CI-20260928-BA94` (parcours principal et alternatif), puis `DEMO-CI-20260928-50DD` après réinitialisation (parcours d'erreurs) |
| Méthode | Playwright, **interface uniquement** : connexion par l'écran de connexion, aucun appel d'API direct, aucune intervention en base. Client et constructeur à 375 px, autres rôles à 1440 px. Mot de passe des comptes généré aléatoirement dans la session, jamais écrit ni capturé. |
| Captures | `docs/audit/captures-parcours-r1/` (nom du fichier cité entre crochets : [m04-f]) |

> **Limite d'indépendance.** Le prompt prévoit un auditeur distinct de la session qui a développé les écrans (CDC §11). Cet audit a été conduit dans la **même** session de travail, sur demande du Product Owner. Les constats reposent sur des captures et des mesures, mais une revue indépendante reste à faire avant la réception (CDC §12.1).

Échelle : **P0** empêche le parcours · **P1** gêne la compréhension · **P2** confort.

---

## 1. Synthèse

Le parcours principal (avec réserve) et le parcours alternatif (sans réserve) sont **démontrables de l'étape 1 à l'étape 9** sans intervention en base. Le Triangle de Confiance se voit : la réserve est motivée et visible chez les trois acteurs, un décaissement est refusé avec son motif, les niveaux de confiance sont datés et attribués. Les étapes **10 (pilotage)** et **11 (archivage)** n'existent pas dans l'interface. La démonstration live en 15 minutes est **fragile** : 18 connexions pour 5 comptes, et une sixième connexion dans la minute échoue.

Les 5 blocages principaux :

1. **Étape 10 absente** : ni indicateurs du §9.3, ni chronologie pour le gestionnaire (P12).
2. **Étape 11 absente** : aucun archivage ni archive consultable dans l'application (P13).
3. **Relais manquants** : le gestionnaire, Finance et le constructeur ne sont pas prévenus quand c'est à eux d'agir (P08 à P11). Le présentateur doit savoir où aller.
4. **Changement de compte** : limite de 5 connexions par minute, avec un message d'erreur générique (P32).
5. **Incohérences visibles à l'écran** : le relevé Finance contredit le dossier, les messages client sont périmés, la réservation du client est annulée sans qu'il en soit informé (P19, P22, P28).

---

## 0 · Mise en route

La pile a été démarrée à partir du dépôt seul, en suivant la documentation du projet, puis la base a été recréée par `scripts/reset_demo_local.sh`. `check_demo_dataset` passe (« Base conforme au jeu initial DEMO-CI-v1 »). Les frictions ci-dessous bloqueraient ou ralentiraient un déploiement (Render) : elles sont classées P1 au minimum, sauf P03 et P07.

| ID | Constat | Attendu | Gravité |
|---|---|---|---|
| P01 | Aucun `README` à la racine du dépôt. Le démarrage est dispersé entre `CLAUDE.md` (section « Stack »), `backend/.env.example` et `DEPLOY_RENDER.md`. | Un guide de démarrage unique : prérequis, variables, commandes backend, worker et fronts, réinitialisation. | P1 |
| P02 | La commande du worker Celery en local n'est documentée nulle part. `DEPLOY_RENDER.md` cite `celery -A config worker` « le jour où le besoin se confirme ». Or `.env.example` impose `CELERY_TASK_ALWAYS_EAGER=False`, donc un worker est nécessaire. | Commande documentée (`celery -A config worker -l info`) et son rôle. | P1 |
| P03 | Redis n'est documenté que par `docker run … redis:7-alpine`. Un Redis natif fonctionne (utilisé ici). | Mentionner l'alternative native. | P2 |
| P04 | Ports Postgres contradictoires : `CLAUDE.md` annonce le `docker-compose.yml` sur 5433, `.env.example` pointe un Postgres natif sur 5432. | Une seule valeur par mode, expliquée. | P1 |
| P05 | `reset_demo_local.sh --dry-run` s'interrompt sur une trace Python quand une migration est en attente (ici `organizations` 0004) : le contrôle d'état lit la nouvelle colonne avant la migration. | Le contrôle signale « migration en attente » sans planter. | P1 |
| P06 | La procédure (`docs/exploitation/PROCEDURE_REINITIALISATION_DEMO.md`) exige « aucune migration en attente » en prérequis, alors que `--confirm` applique justement les migrations. Son en-tête indique encore « Préparée, non exécutée ». | Prérequis cohérent avec le script ; statut à jour. | P1 |
| P07 | `check_demo_dataset` ne vérifie pas le nom ni le rôle affiché des clients (PO-2026-09-28-40). **Vérifié à l'écran pendant le parcours** : « Awa Koné · Cliente fictive » s'affiche dans la liste Dossiers clients [m04-k3], les tâches [m03-a], le sélecteur Finance [m04-c] et le journal [m11-b] ; « Yao Kouassi · Client fictif » s'affiche dans les tâches et les dossiers. | Ajouter ce contrôle au script. | P2 |

---

## 2. Carte du parcours

Mesures relevées sur le parcours principal (Awa, lot A1, avec réserve) ; le parcours alternatif (Yao, lot A2) donne les mêmes relais et retours, avec les compteurs indiqués entre parenthèses. « Actions » compte les clics et saisies, navigation comprise ; « Écrans » compte les pages ou vues traversées par rôle.

| Étape (§9.2) | Rôles | Actions | Écrans | Repérage sans défiler | Relais vers l'acteur suivant | Retour après l'action | Cohérence entre rôles | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 · Catalogue puis fiche bien | Visiteur | 3 | 2 | Oui (« Voir les programmes ») [m01-a] | Sans objet ; « Réserver — accès sur invitation » mène à la page d'accès [m01-d] | Plan A1 en plein écran [m01-c] ; pas de fiche bien dédiée | « 2 lots disponibles », prix et plan cohérents [m01-b] | FRICTION (P36) |
| 2 · Dossier et réservation | Client | 1 (1) | 1 | **Non** : « Réserver ce bien » sous la ligne de flottaison à 375 px [m02-a] | Tâche « Dossier à examiner — … Awa Koné · Cliente fictive » chez le gestionnaire [m03-a] | Bien bloqué jusqu'à 18:44 le lendemain, frais attendus, « votre conseiller examine votre dossier » [m02-c] | Client et gestionnaire : « Bien bloqué » | FLUIDE |
| 3 · Contrat et calendrier | Gestionnaire puis client | 8 + 3 (6 + 2) | 2 + 1 | Gestionnaire : oui pour l'examen, **non** pour « Créer le brouillon » ; client : **non** (case et « Signer ») [m03-i] | Client : « Votre prochaine action — Signer votre contrat (version 1) » et une tâche [m03-i, m03-k] | Contrat « Approuvé … approuvée le … par … · Gestionnaire » [m03-h] ; aucun message de confirmation ; bouton inactif sans explication (P24) | Échéance du blocage modifiée (18:44 → 18:46) sans explication (P22) | FRICTION |
| 4 · Encaissements | Client, Finance, gestionnaire | 2 + 15 + 4 + 2 + 10 (Finance : 10 + 10) | Finance 1 page, 2 onglets | Finance : non (formulaire sous les indicateurs) [m04-c] | Finance : tâche « Virement signalé à traiter — 100 000 XOF, réf. client VIR-AWA-0001 » [m04-b] ; **gestionnaire : aucune tâche pour appeler le complément** [m04-k] | Réservée puis Concrétisée ; espace client à jour « Acquisition concrétisée (simulée) » [m04-o] | **Relevé et dossier contradictoires** sur le même écran jusqu'au rechargement (P19) [m04-f] ; message client périmé (P22) [m04-j] | FRICTION |
| 5 · Chantier | Constructeur | 4 (5) | 2 | **Non** : « Déclarer ce jalon » hors écran [m05-b] | **Aucun** : l'arrivée affiche « Aucune exception — tout est à jour » [m05-a] ; le gestionnaire n'a pas de tâche d'affectation [m06-a] | « Soumis », « En attente de l'affectation d'un contrôleur », niveaux Déclaré et Documenté datés [m05-d] | Carte « Prochain jalon à déclarer : Élévation » alors que Fondations est au brouillon (P21) | FRICTION |
| 6 · Inspection | Gestionnaire puis contrôleur | 3 + 6 (2 + 4) | 1 + 2 | Oui [m06-d] | Contrôleur : mission listée avec numéro et date [m06-d] ; constructeur : réserve dans « À traiter » avec motif et action attendue [m07-a] | « Avis enregistré — horodatage serveur : 28 sept. 2026, 18:58 » ; rien sur la suite (P30) [m06-f] | Réserve identique chez constructeur [m07-b] et client [m09-d] | FRICTION (P09, P15) |
| 7 · Correction puis recontrôle | Constructeur, gestionnaire, contrôleur | 3 + 2 + 6 | 1 + 1 + 2 | Constructeur : **non** (« Proposer la correction ») | Gestionnaire : **aucune tâche** pour le recontrôle [m07-d] ; contrôleur : « Mission de suivi — Réserve #f1b02bf8 » [m07-f] | Constructeur : l'écran bascule sur « Élévation » **sans confirmation** (P20) [m07-c] ; contrôleur : horodatage | Versions v1 et v2 conservées [m07-g] ; « Accepté techniquement » partout [m07-i, m09-d] | FRICTION |
| 8 · Décaissement | Finance puis constructeur | 6 + 2 + 2 (7) | 1 + 1 + 1 | Oui (ligne « Réunies ») [m08-a] | Finance : **aucune tâche** ; constructeur : **aucune** (« tout est à jour ») | Soldes mis à jour (3 000 000 → 2 000 000 disponibles) ; « Réception confirmée par le bénéficiaire (simulé) » [m08-g] ; exécution **sans confirmation** (P23) | Sélecteur de programme non rafraîchi (P35) [m08-d] | FRICTION |
| 9 · HOME client | Client | 0 (+1 lien) | 1 | Oui | Sans objet | Façade-jauge, « 1 / 2 », réserve et levée datées, versements [m09-a, m09-d] | Cohérent avec BUILD et Finance ; **sortie programme absente** (P14) | FRICTION |
| 10 · Pilotage | Gestionnaire | — | — | — | — | Aucun écran d'indicateurs (§9.3) ; « Programmes » est un assistant de création [m10-b] ; pas de chronologie dans le dossier [m10-d] | — | **BLOQUANT** (P12) |
| 11 · Administration | Administrateur | — | — | — | — | Menu : Utilisateurs, Journal, Paliers ; **aucun archivage** [m11-a] ; journal en codes techniques [m11-b] ; réinitialisation possible seulement par script, archive non consultable | — | **BLOQUANT** (P13) |

### Parcours d'erreurs

| Test | Action (interface) | Résultat observé | Verdict |
|---|---|---|---|
| T01 | Awa et Yao cliquent « Réserver ce bien » (A1) au même instant | Yao obtient le blocage ; Awa reçoit « Ce lot n'est plus disponible à la réservation. » Le lot reste affiché avec un bouton actif (P29) [e-T01-a, e-T01-b] | Réussi (friction P2) |
| T02 | Blocage impayé expiré, puis nouvelle réservation | Expiration à 24 h, non déclenchable depuis l'interface (aucune intervention en base). Chemin voisin testé : annulation motivée par le gestionnaire [e-T02-a], bien libéré puis réservé par Awa [e-T20-b] ; **Yao n'est pas informé** (P28) [e-T02-b] | **NOT_TESTED** (expiration) |
| T05 | Le constructeur tente de lever sa réserve | Aucune commande de levée ni d'acceptation côté constructeur ; explication affichée « Seul le contrôleur lève une réserve » [e-T05-a]. Refus serveur non testé (API interdite) | Réussi par l'interface ; serveur NOT_TESTED |
| T08 | Le client modifie un identifiant dans l'URL | L'espace client n'expose aucun identifiant dans l'URL (liens `/tasks`, `#acquisition`, `#actions`) ; une URL forgée affiche son propre dossier, sans autre contenu [e-T08-a] | Réussi par l'interface ; refus API NOT_TESTED |
| T09 | Finance demande un décaissement avec une réserve ouverte | Jalons bloqués masqués par défaut, motif affiché une fois « tous les jalons » affichés [e-T09-b] ; « Préparer » crée un brouillon (P25) [e-T09-c] ; le contrôle d'éligibilité refuse : « Décaissement non éligible : jalon non accepté techniquement dans sa version courante ; réserve ouverte sur le lot. » Aucun montant réservé [e-T09-d] | Réussi (friction P2) |
| T11 | Décaissement exécuté sans confirmation du bénéficiaire | « Rapprocher sans confirmation (motif : Confirmation bénéficiaire non reçue) » ; absence conservée et visible [a08-a] | Réussi |
| T12 | Versement partiel puis excédentaire | 5 000 000 sur 12 000 000 : « Partiellement couvert » [e-T12-b] ; 8 000 000 reçus, 7 000 000 affectés : « Non affecté 1 000 000 XOF », jamais imputé [e-T12-c] ; le client voit toujours 12 000 000 à virer (P27) [e-T12-d] | Réussi (friction P1) |
| T14 | Réinitialisation après parcours complet | Procédure documentée exécutée (7 s) : nouvelle instance `DEMO-CI-20260928-50DD`, sauvegarde `~/keya-backups/20260928T191630Z`. **Archive non consultable** dans l'application (P13) | Partiel |
| T20 | Parcours client au clavier seul (375 px) | 7 tabulations jusqu'à « Réserver ce bien », focus visible (contour 2 px) [e-T20-a], Entrée réserve le bien [e-T20-b]. Signature et virement au clavier non testés | Partiel (réservation) ; reste NOT_TESTED |

---

## 3. Journal des frictions

Les frictions P01 à P07 (mise en route) sont en section 0.

| ID | Étape | Rôle | Ce qui se passe | Attendu | Réf. | Gravité | Capture |
|---|---|---|---|---|---|---|---|
| P08 | 4 | Gestionnaire | Après encaissement des frais, aucune tâche « appeler le complément du premier versement » : « Rien en attente : tout est à jour » | Tâche ou mention « à vous » dès que la réservation passe à Réservée | §9.2 étape 4, T19 | P1 | m04-k |
| P09 | 5, 6, 7 | Gestionnaire | Déclaration soumise, puis correction resoumise : aucune tâche d'affectation ; seul l'écran « Contrôles à affecter » le montre | Tâche d'affectation (PO-2026-09-28-33 : « Gestionnaire (affectation du contrôle) ») | §7.1, PO-33 | P1 | m06-a, m07-d |
| P10 | 8 | Finance | Jalon accepté techniquement : aucune tâche ; Finance doit penser à ouvrir « Comptes & décaissements » (mesure : « Rien en attente » à 19:00) | Tâche « jalon décaissable » | §8.2 | P1 | m08-a |
| P11 | 5, 8 | Constructeur | Concrétisation du dossier puis exécution du paiement : « Aucune exception — tout est à jour » ; rien n'invite à déclarer ni à confirmer la réception | Mention de la prochaine action (déclarer ; confirmer la réception) | §9.2 étapes 5 et 8 | P1 | m05-a |
| P12 | 10 | Gestionnaire | Pas d'écran de pilotage : aucun indicateur du §9.3 (jalons examinés, paiements rapprochés, réserves, pièces), pas de chronologie du dossier | Indicateurs calculés, « Non applicable » si dénominateur nul, reconstruction chronologique | §9.2 étape 10, §9.3 | **P0** | m10-b, m10-d |
| P13 | 11 | Administrateur | Aucun archivage d'instance ni archive consultable ; la réinitialisation se fait hors application et l'ancienne instance n'existe plus que dans la sauvegarde | Archivage puis nouvelle instance, archive en lecture seule (T14) ; différé par PO-2026-09-28-25 (proposition seulement) | §9.2 étape 11, T14, PO-25 | **P0** | m11-a |
| P14 | 9 | Client | La sortie du programme vers le constructeur (décaissement) n'apparaît nulle part dans l'espace client | « Sortie programme présentée comme telle, jamais comme sa dette personnelle » | §9.2 étape 9 | P1 | m09-a |
| P15 | 6 | Gestionnaire | « KEYIMMO missionne le contrôleur ; le constructeur ne le choisit jamais », bouton « Missionner » ; BUILD : « désigné et missionné indépendamment » | Formule du PO : désignation indépendante, modalités définies pour le Projet 1 | J03, PO-2026-09-27-01 | P1 | m06-b, m05-e |
| P16 | 3 | Gestionnaire, client | « La réservation doit d'abord être validée par l'ADV » ; conseiller nommé « Gestionnaire ADV » ; bouton cloche « Task Inbox » (anglais, lu par les lecteurs d'écran) | Verbe « examiner », pas de sigle interne, libellés français | J07, glossaire | P1 | m03-b, m03-j |
| P17 | 11 | Administrateur | Journal en codes techniques : `disbursement.reconciled`, `sales.customerreceipt · 325f6d34` ; aucun événement de chantier (déclaration, avis, réserve) | Libellés métier, chronologie complète | §9.2 étape 10, §10 | P1 | m11-b |
| P18 | 4 | Gestionnaire | La liste Dossiers clients est filtrée par défaut sur « Biens bloqués » : le dossier d'Awa disparaît dès qu'il passe à Réservée | Filtre « À traiter » ou « Toutes » par défaut | §9.2 | P2 | m04-k2 |
| P19 | 4 | Finance | Même écran : le dossier indique « Rapproché (simulé), non affecté 0 XOF », le relevé « Exécuté par la banque, non affecté 100 000 XOF », jusqu'au rechargement ; juste après l'enregistrement, le relevé dit « Aucun encaissement enregistré » | Relevé rafraîchi après chaque action | §8.1, §9.2 | P1 | m04-e, m04-f |
| P20 | 7 | Constructeur | Après « Proposer la correction », la vue bascule sur le jalon Élévation ; aucun message ne confirme la correction | Rester sur le jalon et confirmer : « Correction proposée — en attente de recontrôle » | §7.1 | P1 | m07-c |
| P21 | 5 | Constructeur | Carte « Prochain jalon à déclarer : Élévation » alors que Fondations est encore au brouillon | Prochain jalon = premier non déclaré | §7.1 | P2 | m05-b |
| P22 | 3, 4 | Client | « Suite : signature du contrat » affiché après la signature ; une seule « prochaine action » annoncée mais deux demandées (signer, puis régler) ; échéance du blocage 18:44 puis 18:46 | Message à jour ; une action à la fois ; échéance stable ou expliquée | §6.1, §9.2 | P2 | m04-j, m03-i |
| P23 | 8 | Finance | « Exécuter (simulé) », irréversible, s'exécute sans confirmation | Confirmation (« Aucune annulation après exécution ») | §8.2, question 5 | P1 | m08-d |
| P24 | 3, 8 | Gestionnaire, Finance | « Créer le brouillon » et « Préparer » inactifs sans explication tant que le champ est vide | Indication du champ requis | §9.2 | P2 | m03-b |
| P25 | Erreurs (T09) | Finance | « Préparer » est proposé sur un jalon bloqué et crée un brouillon, refusé seulement au contrôle d'éligibilité | Préparation indisponible avec le motif, ou refus immédiat | §8.2 | P2 | e-T09-c |
| P26 | 8 | Finance | Le jalon A1 Fondations, déjà décaissé de 1 000 000, reste « Réunies — Préparer » sans rappel du montant déjà sorti | Montant déjà décaissé affiché sur la ligne | §8.2 | P2 | m08-g |
| P27 | Erreurs (T12) | Client | Après un versement partiel (5 000 000 encaissés), le bloc de virement indique toujours « MONTANT 12 000 000 XOF » | Reste à verser (7 000 000) dans les instructions | §8.1 | P1 | e-T12-d |
| P28 | Erreurs (T02) | Client | Réservation annulée par le gestionnaire : l'espace de Yao revient au catalogue sans mention de l'annulation ni du motif | Événement visible : « Réservation annulée le … — motif … » | §6.1 | P1 | e-T02-b |
| P29 | Erreurs (T01) | Client | Après le refus, le lot A1 reste affiché avec « Réserver ce bien » actif sous le message d'erreur | Catalogue rafraîchi | §6.1 | P2 | e-T01-a |
| P30 | 3, 6, 8 | Tous | Les confirmations disent ce qui est enregistré (quand il y en a) mais jamais ce qui suit ni qui agit | « Avis enregistré — le constructeur doit maintenant… » | Question 3 et 4 | P2 | m06-f |
| P31 | 2, 3, 5, 7 | Client, constructeur | À 375 px, l'action principale est sous la ligne de flottaison : « Réserver ce bien », « Signer », « Déclarer ce jalon », « Proposer la correction » | Action principale visible à l'arrivée | T20 | P2 | m02-a, m05-b |
| P32 | Démo | Tous | Limite de 5 connexions par minute : la sixième échoue sur « Une erreur est survenue. Réessayez. » (mesuré) ; le parcours principal demande 18 connexions | Message explicite (« Trop de tentatives, réessayez dans … ») ; démonstration avec une session ouverte par rôle | §10 | P1 | e-login-6e-connexion |
| P33 | 3, 9 | Client | « Mes actions » liste des tâches non cliquables, qui s'accumulent (5 en attente après le palier) | Tâche reliée à l'action, fermée quand l'action est faite | §9.2 | P2 | m03-k |
| P34 | 8 | Finance | Date de sortie au format « 2026-09-28 » dans la liste des décaissements | « 28 sept. 2026 » (F06) | Design system §9 | P2 | m08-d |
| P35 | 8 | Finance | Le sélecteur de programme affiche « disponible 3 000 000 XOF » alors que l'indicateur « Disponible » vaut 2 000 000 | Même valeur partout | §8.2 | P2 | m08-d |
| P36 | 1 | Visiteur | Pas de fiche bien dédiée : la carte du programme sert de fiche ; « Réserver — accès sur invitation » mène à une page sans suite pour un visiteur | Fiche bien (caractéristiques, disponibilité) ; parcours visiteur clair | §9.2 étape 1 | P2 | m01-b, m01-d |

---

## 4. Incohérences entre rôles

| Objet | Rôle A | Rôle B | Écart | Capture |
|---|---|---|---|---|
| Encaissement des frais (A1) | Finance, fiche du dossier : « Rapproché (simulé) », non affecté 0 XOF | Finance, relevé du même écran : « Exécuté par la banque (simulé) », non affecté 100 000 XOF | Jusqu'au rechargement | m04-f |
| Contrat (A1) | Gestionnaire : « Signé (simulé) » | Client : « Suite : signature du contrat et complément du premier versement » | Message client périmé | m04-j |
| Échéance du blocage (A1) | Client à la réservation : jusqu'au 29 sept., 18:44 | Client et gestionnaire après l'examen : 18:46 | L'échéance change sans explication | m02-c, m03-i |
| Disponible du compte programme | Finance, indicateur : 2 000 000 XOF | Finance, sélecteur de programme : 3 000 000 XOF | Sélecteur non rafraîchi | m08-d |
| Décaissement 1 000 000 XOF (A1) | Finance et constructeur : exécuté, confirmé, rapproché | Client : aucune trace | Sortie programme absente (P14) | m08-g, m09-a |
| Réservation annulée (Yao) | Gestionnaire : « Annulée par … · Gestionnaire », motif | Client : catalogue vierge | Événement non transmis (P28) | e-T02-a, e-T02-b |
| Jalon Fondations (A2) | Constructeur : « Accepté techniquement » | Gestionnaire et client : « Accepté techniquement » | **Aucun écart** (vérifié au même moment) | a07-a, a07-b, a07-c |

---

## 5. Script de démonstration (15 minutes)

Hypothèse : une fenêtre de navigateur **déjà connectée par rôle** (visiteur, Awa, gestionnaire, Finance, constructeur, contrôleur, administrateur). Sans cette préparation, les 18 connexions du parcours se heurtent à la limite de 5 par minute (P32). Le complément du premier versement (étape 4, seconde moitié) est joué avant la séance sur le dossier de Yao, sinon le script dépasse 15 minutes.

| Minute | Compte | Écran | Action | Message clé |
|---|---|---|---|---|
| 0:00 | Visiteur | Page publique | Défiler : façade, « Trois rôles distincts », frise « 1 · Déclaration → 4 · Jalon suivant » | « Trois acteurs distincts : qui encaisse, qui examine, qui décaisse. Tout est fictif et simulé. » |
| 1:00 | Awa | Mon acquisition | Réserver le lot A1 (1 clic, défiler) | « Le bien est bloqué pour Awa, avec son échéance et les frais attendus. » |
| 2:00 | Gestionnaire | À faire → dossier | Examiner le dossier ; rédiger, soumettre et approuver le contrat | « Le gestionnaire prépare, il ne valide pas les travaux. » ⚠ taper le contenu du contrat (P24) |
| 3:30 | Awa | Mon acquisition | Cocher et signer (simulé) ; signaler le virement | « Signature simulée, marquée SIMULÉ ; un signalement n'est pas un encaissement. » |
| 4:30 | Finance | Encaissements | Enregistrer 100 000, affecter, rapprocher, rattacher | « Seul le relevé fictif fait foi. » ⚠ relevé incohérent jusqu'au rechargement (P19) |
| 6:00 | Awa | Mon acquisition | Montrer « Réservée », puis le dossier de Yao concrétisé (préparé) | « Réservée après les frais, concrétisée seulement après le premier versement. » |
| 6:30 | Constructeur | Chantiers & jalons | Déclarer Fondations, joindre la pièce | « Déclaré, documenté : rien n'est encore accepté. » ⚠ chercher l'écran (P11) |
| 7:30 | Gestionnaire | Contrôles à affecter | Affecter le contrôleur | ⚠ aucune tâche ne l'indique (P09) ; ne pas dire « missionner » (P15) |
| 8:00 | Contrôleur | Mission | Cocher la version examinée, avis non conforme, réserve motivée | « Le contrôleur ne voit que sa mission ; son avis porte sur la version examinée. » |
| 9:00 | Constructeur | Jalon | Voir la réserve ; proposer la correction avec une nouvelle pièce | « Le constructeur corrige, il ne lève jamais la réserve. » ⚠ l'écran saute sur Élévation (P20) |
| 10:00 | Finance | Comptes & décaissements | Afficher tous les jalons : A1 « Bloqué — réserve ouverte » | **Moment fort** : « Aucun décaissement tant que la réserve est ouverte. » |
| 10:30 | Gestionnaire, puis contrôleur | Contrôles ; mission de suivi | Réaffecter ; lever la réserve, avis conforme | « Versions 1 et 2 conservées ; acceptation seulement après levée. » |
| 11:30 | Finance | Comptes & décaissements | Préparer 1 000 000, contrôler l'éligibilité, exécuter (simulé) | « Le montant est réservé, puis sort ; le solde se met à jour. » ⚠ pas de confirmation (P23) |
| 12:30 | Constructeur, puis Finance | Paiements reçus ; décaissements | Confirmer la réception ; rapprocher | « La confirmation du bénéficiaire n'est pas une preuve bancaire. » |
| 13:30 | Awa | Suivi du chantier | Façade-jauge, « 1 / 2 », réserve levée, « Voir qui a vérifié quoi, et quand » | **Moment fort** : « L'acquéreur voit ce qui a été vérifié, par qui et quand. » |
| 14:30 | Administrateur | Journal | Montrer la chronologie des actes | ⚠ codes techniques, pas de pilotage ni d'archivage : l'annoncer comme à venir (P12, P13, P17) |

Moments où le présentateur doit **changer de compte** : 15 fois (chaque ligne sauf la première) ; **chercher** un écran : 7:30, 10:00, 11:30 (relais manquants) ; **expliquer** une incohérence : 4:30, 9:00, 14:30 ; **attendre** : chaque connexion au-delà de 5 par minute, si les fenêtres ne sont pas ouvertes à l'avance.

**Les 3 moments les plus convaincants**

1. La réserve motivée du contrôleur, visible chez le constructeur (motif, action attendue, auteur, date) et chez le client en langage simple, avec la phrase « Aucun paiement au constructeur n'est possible tant que cette réserve est ouverte » [m07-b, m09-d].
2. Le décaissement bloqué par la réserve ouverte, avec le motif, puis le refus d'éligibilité explicite (T09) [e-T09-b, e-T09-d].
3. Les niveaux de confiance datés et attribués, liés à la version de pièce examinée, et la façade-jauge du client [m07-i, m09-d] ; la réservation concurrente refusée proprement (T01) [e-T01-a].

**Les 3 moments les plus fragiles**

1. Le passage de relais : le gestionnaire, Finance et le constructeur n'ont pas de tâche quand c'est à eux, et le présentateur doit savoir où cliquer (P08 à P11).
2. La fin du scénario : pas de pilotage, pas d'archivage (P12, P13) ; le journal en codes techniques ne remplace pas la chronologie attendue (P17).
3. L'écran Encaissements de Finance : 10 actions pour un encaissement, et un relevé qui contredit le dossier jusqu'au rechargement (P19) ; plus la limite de connexions (P32).

---

## 6. Recommandations

| Gravité | Recommandation | Frictions résolues | Change le périmètre ? |
|---|---|---|---|
| P0 | Écran de pilotage du gestionnaire : indicateurs §9.3 calculés, « Non applicable » si dénominateur nul, chronologie du dossier | P12, P17 (partie chronologie) | Non (CDC §9.2 étape 10, §9.3) — mais volume de travail à arbitrer par le PO |
| P0 | Archivage d'instance consultable en lecture seule, selon `docs/demo/ARCHIVE_INSTANCE_PROPOSITION.md` | P13 | Non (CDC étape 11, T14) ; **reporté par PO-2026-09-28-25** : à re-arbitrer si l'étape 11 doit être démontrée |
| P1 | Tâches de relais : « appeler le complément », « affecter / réaffecter un contrôleur », « jalon décaissable », « déclarer le jalon », « confirmer la réception » | P08, P09, P10, P11 | Non (T19 : « HOME et indicateurs reflètent les événements ») |
| P1 | Préparer la démonstration avec une session ouverte par rôle ; message explicite quand la limite de connexions est atteinte | P32 | Non |
| P1 | Rafraîchir le relevé Finance, les messages client et le sélecteur de programme après chaque action | P19, P22, P35, P29 | Non |
| P1 | Afficher au client la sortie programme (décaissement au constructeur) comme telle, et le reste à verser après un paiement partiel ; lui notifier l'annulation de sa réservation | P14, P27, P28 | Non (§9.2 étape 9, §8.1, §6.1) |
| P1 | Confirmation avant exécution d'un décaissement ; rester sur le jalon après une correction et la confirmer | P23, P20 | Non |
| P1 | Aligner le vocabulaire : « affecter » plutôt que « missionner », « examiner » plutôt que « valider », pas de « ADV » ni de « Task Inbox » ; journal en libellés métier | P15, P16, P17 | Non |
| P1 | Documentation de démarrage unique (README) : worker Celery, ports, Redis natif ; `--dry-run` tolérant aux migrations en attente ; procédure de réinitialisation mise à jour | P01 à P06 | Non |
| P2 | Actions principales visibles à l'arrivée à 375 px ; indication des champs requis ; confirmations qui disent la suite | P24, P30, P31 | Non |
| P2 | Filtre par défaut des dossiers, « Prochain jalon à déclarer », montant déjà décaissé par jalon, « Préparer » indisponible sur un jalon bloqué, dates au format F06, tâches client cliquables | P18, P21, P25, P26, P33, P34 | Non |
| P2 | Fiche bien dédiée pour le visiteur | P36 | **Changement de périmètre — arbitrage PO** (la carte du programme fait aujourd'hui office de fiche) |
| P2 | Contrôle des libellés clients dans `check_demo_dataset` | P07 | Non |

**Non testé** (NOT_TESTED) : expiration du blocage à 24 h (T02) ; refus serveur des tentatives T05 et T08 (API directe interdite par la méthode ; couvert par la suite backend) ; signature et virement au clavier (T20) ; T03 à T20 hors ceux cités ci-dessus.
