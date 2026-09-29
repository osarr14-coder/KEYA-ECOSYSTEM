# Revue assistée R1 — branche `fix/audit-ui-r1`

> **Ce document n'est pas la revue indépendante du CDC §11.** C'est un élément du **dispositif
> compensatoire** prévu par `docs/recette/PROCEDURE_REVUE_INDEPENDANTE.md` §5 : une relecture
> assistée, qui ne peut remplacer ni la revue humaine signée, ni le visa du PO.
>
> **Limite d'indépendance, à lire en premier.** Cette revue a été conduite par la **même session
> Claude Code** que celle qui a écrit le code de la branche (même compte, même contexte de travail).
> Elle n'est donc pas indépendante au sens du §11 (« deux agents sous un même compte ne sont pas deux
> approbateurs indépendants »), et encore moins qu'un autre agent. Ses constats valent comme pistes
> et preuves reproductibles, pas comme approbation. Consigne suivie : relecteur, pas développeur ;
> **aucun fichier applicatif modifié**, aucune correction.

| | |
|---|---|
| Branche revue | `fix/audit-ui-r1`, commit **`0119817`** |
| Base | `163b96c` (dernier commit commun avec `master`) |
| Référentiel | CDC R1 (§9.2, §10, §11, §12.1), `docs/decisions/JOURNAL_DECISIONS.md`, `docs/recette/FICHE_T01_T20.md` |
| Date | 29 septembre 2026, 12:05 → 12:30 (GMT) |
| Instance jouée | `DEMO-CI-20260929-9E04` (jeu `DEMO-CI-v2`), créée pour cette revue |
| Légende | **CONFIRMÉ** (le comportement attendu est observé, preuve jointe), **ÉCART** (le comportement observé s'écarte du référentiel), **NOT_TESTED** (non vérifié) |

## 1. Environnement et instance

| Point | Statut | Preuve |
|---|---|---|
| Pile démarrée à partir du dépôt | CONFIRMÉ, avec réserve | Voie « Postgres natif local » documentée par `backend/.env.example` (le démon Docker de `backend/docker-compose.yml` ne répond pas dans cet environnement). Postgres 16 et Redis démarrés comme services ; **environnement Python neuf** créé depuis `backend/requirements.txt` ; `manage.py migrate --check` : aucune migration en attente ; serveur `runserver` sans surcharge de réglage (blocage de 24 h par défaut). **Réserve** : le fichier `backend/.env` local (non suivi, créé lors de sessions antérieures) a été réutilisé pour les paramètres de connexion ; son contenu n'a pas été affiché. |
| Fronts | NOT_TESTED | Les applications React n'ont pas été démarrées : tous les rejeux ci-dessous sont faits **par l'API** (autorisé par la consigne), aucun par l'écran. |
| Instance neuve depuis le jeu versionné | CONFIRMÉ | `manage.py archive_demo_instance --confirm --reseed` : « Instance DEMO-CI-20260929-2655 archivée. Nouvelle instance DEMO-CI-20260929-9E04 (DEMO-CI-v2) » (2655 était vide ; l'archive `DEMO-CI-20260929-6BB7` n'est pas touchée, PO-2026-09-29-08). `manage.py check_demo_dataset` : « Base conforme au jeu initial DEMO-CI-v2 » (lots A1/A2 disponibles à 30 000 000, 2 jalons, 4 + 3 pièces exigées, aucune action préremplie). |
| Mot de passe des comptes de démo | CONFIRMÉ | Valeur aléatoire générée dans la session, tenue par un processus en mémoire, passée à `seed_demo_scenario` par `DEMO_PASSWORD` ; lue à l'exécution par le client de revue, jamais affichée ni écrite. Recherche de la valeur dans le dépôt et dans les preuves : **aucune occurrence**. |
| Outillage | — | Client d'API écrit pour cette revue (aucun script des sessions précédentes réutilisé). Preuves consignées au fil de l'eau, **sans jeton ni mot de passe**, dans un journal hors dépôt (21 entrées) ; les éléments probants sont recopiés ci-dessous. |

## 2. Tests rejoués

| Test | Statut | Mode | Preuve |
|---|---|---|---|
| **T01** — deux clients, même bien, même instant | **CONFIRMÉ** | API | Awa et Yao envoient `POST /api/reservations/` sur A1, synchronisés par une barrière : Yao **201** (`held`, échéance à +24 h), Awa **409** « Ce lot n'est plus disponible à la réservation. » ; A1 disparaît du catalogue (seul A2 reste) ; « Mes réservations » : Awa aucune, Yao A1 `held`. |
| **T05** — le constructeur ne peut ni accepter ni lever une réserve | **ÉCART** (partiel) | API | Préparation par le parcours réel : dossier de Yao concrétisé (voir §4), déclaration de Fondations A1 (201), pièce « Plan d'implantation » (201), affectation par le gestionnaire (201), avis **avec réserve** du contrôleur (201) ; état : `under_reserve` / `CHANGES_REQUESTED`, réserve ouverte. Tentatives du constructeur : `POST /api/inspections/` avis conforme **403**, avis avec décision « levée » **403**, `POST /api/control/missions/<id>/avis/` **403** (« Seul un membre avec le rôle inspecteur… »), `PATCH` et `DELETE /api/reserves/<id>/` **405**. État après : **inchangé**. → **Refus serveur et absence de mutation : CONFIRMÉ.** **« Tentative tracée » (CDC §12.1) : ÉCART** — aucune entrée au journal métier (`/api/admin/journal/` : aucune action de refus sur toute la période) ; la seule trace est le journal technique du serveur (« Forbidden: /api/inspections/ »), sans acteur ni objet métier. La fiche de l'auteur marque T05 CONFORME sans ce critère. |
| **T08** — un client change l'identifiant de dossier/contrat/fichier | **CONFIRMÉ** (export NOT_TESTED) | API | Awa, sur le dossier concrétisé de Yao, 16 sondes : `worksite`, `payment-calls`, `contracts`, `cancel`, signature du contrat, signalement de virement, `overview`/`evidence` du lot, document, lien signé, pièce, déclaration → **404** ; chronologie, dossier Finance, appels et contrats d'équipe → **403** (message de rôle, sans contenu). Recherche dans chaque réponse du nom de Yao, de son e-mail, de l'identifiant du contrat, des références bancaires et du prix : **aucune fuite**. Dossier de Yao **intact** (`committed`). Partie « export » : aucune fonction d'export (reportée au Projet 1, PO-2026-09-29-07). |
| **T09** — décaissement avec réserve ouverte ou disponible insuffisant | **CONFIRMÉ** | API | Compte du programme avant : reçu 3 000 000, exécuté 0, disponible 3 000 000, `simulation: true`. (1) **Réserve ouverte** : la demande est préparée en brouillon (201) mais l'éligibilité est refusée **409** « jalon non accepté techniquement dans sa version courante ; réserve ouverte sur le lot », l'exécution forcée **409** « Seule une demande éligible s'exécute ». (2) Après correction et levée par le contrôleur (parcours réel), demande annulée par Finance puis nouvelle demande de **4 000 000** : éligibilité **409** « disponible insuffisant (3000000.00 XOF disponibles) », exécution forcée **409**. Solde final **inchangé** (exécuté 0, disponible 3 000 000) : aucune exécution, jamais de solde négatif. Observation : une demande peut être préparée (brouillon) sur un jalon non éligible ; le refus porte sur l'éligibilité et l'exécution, ce qui satisfait « aucune exécution créée ». |
| **T15** — dépôt interdit, trop volumineux, non analysé ; accès direct au stockage | **ÉCART** (partiel) | API | **Formats (PO-2026-09-29-05) : CONFIRMÉ** — `facture.bat` au contenu PDF, `.exe` déclaré PDF, `page.html`, `image.svg` avec script, PDF déclaré `image/png`, `photo.png` au contenu PDF, `faux.pdf` au contenu texte → **400** « Format non autorisé : seuls PDF, JPEG et PNG sont acceptés » ; **taille** : 10 Mo + 10 octets → **400** « Fichier trop volumineux — 10485760 octets maximum. » ; **rien de stocké** (documents 11 → 11, fichiers du stockage 11 → 11). Contrôle positif : un vrai PNG est accepté (201). **Accès direct au stockage : CONFIRMÉ** — fichiers renommés par identifiant ; `GET /media/<chemin réel>` sans authentification → **404** (le média n'est pas servi) ; lien signé : propriétaire **200**, anonyme **401**, autre compte **404** ; le détail d'un document n'expose pas de chemin de fichier. **« Analyser les dépôts » (CDC §10) : ÉCART** — aucune analyse antivirus ni quarantaine dans le code (recherche `clamav`, `antivirus`, `quarantaine`, `scan` : aucun résultat hors tests) ; un fichier conforme est disponible dès son dépôt. |
| **T16** — modification/suppression d'événement via l'application ou le compte applicatif | **ÉCART — critique** | API ; base (compte applicatif) | **Par l'application : CONFIRMÉ** — `PUT`/`PATCH`/`DELETE /api/admin/journal/` → **405**, sur une entrée → **404** ; première entrée identique avant/après. **Par le compte applicatif `keya_ecosystem_app`** (non superuser, sans `BYPASSRLS`), dans une transaction **annulée** à la fin : `UPDATE` et `DELETE` sur `audit_event` et `trust_event` → **0 ligne** (triggers `*_no_update`/`*_no_delete` et absence de policy d'écriture) ; mais **`TRUNCATE audit_event` et `TRUNCATE trust_event` s'exécutent** ; et, le compte étant **propriétaire des deux tables** (`pg_tables.tableowner`), il peut `ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update`, `ALTER TABLE audit_event NO FORCE ROW LEVEL SECURITY`, puis **modifier un événement (1 ligne)**. Tout a été annulé (retour arrière vérifié : trigger actif, FORCE RLS vrai ; 96 et 38 lignes visibles avant/après). Le CDC §10 exige que « l'utilisateur applicatif ne dispose pas de modification/suppression du journal ». La fiche de l'auteur marque T16 CONFORME sur la seule preuve « 0 ligne touchée ». Cause hors du diff de la branche (propriété des tables issue de l'initialisation de la base), mais bloquante pour la réception (§12.1 : aucune anomalie critique sur le journal). |

## 3. Lecture du diff `163b96c..0119817`

Périmètre lu en priorité : les 74 fichiers applicatifs du backend modifiés (hors tests et migrations),
les routes ajoutées, la configuration. Les fronts (React) n'ont pas été relus.

| Point | Statut | Preuve |
|---|---|---|
| **Droits serveur sur les routes ajoutées par la branche** | CONFIRMÉ | Matrice rôle × route, 7 comptes (admin, gestionnaire, Finance, constructeur, contrôleur, Yao, Awa) : `admin/journal` admin seul (200, autres 403) ; `admin/instances` admin et gestionnaire ; `admin/instances/archive` admin seul (400 sur code faux, autres 403 — aucun archivage déclenché) ; `pilotage/indicateurs` et sources, `dossiers/<id>/chronologie` gestionnaire seul ; `control/missions/<id>` contrôleur affecté seul ; `finance/receipts` Finance seul ; `me/reservations/<id>/worksite` client du dossier seul (autres 404) ; `build/disbursements` constructeur seul. |
| **Routes anonymes** | CONFIRMÉ | Balayage des **120** routes `/api/…` sans authentification, en GET et en POST : hors 401/403/405, seules répondent `auth/login` et `auth/login/refresh` (400 sans identifiants), `public/demo-instance` (code, version, statut, environnement de l'instance) et `public/offer` (programme, lots, prix, surfaces, échéancier : **aucune donnée personnelle ni état de dossier/jalon**). `auth/register` → **404** (R01) ; `public/worksites` → **404** (PO-2026-09-28-38) ; modules différés et synchronisation hors ligne → **404** avant toute authentification. Observations hors diff : l'interface d'administration Django (`/admin/`) présente sa page de connexion à un visiteur anonyme ; en local (`DEBUG` actif dans `.env`), les 404 renvoient la page de débogage listant les routes — `DEBUG` vaut `False` par défaut et dans `render.yaml`. |
| **Transitions d'état non protégées** | CONFIRMÉ | Réservation : transitions par services seulement ; `PATCH /api/lots/<A1>/` `commercial_status: disponible` sur un lot concrétisé → gestionnaire **409** « son statut commercial suit le cycle de réservation », constructeur **403** ; dossier intact. **PO-2026-09-29-09** (chantier après concrétisation) : sur A2 sans dossier, « Prochaine étape » = « Concrétisation du dossier (chantier non ouvert) », `chantier_open: false`, déclaration **400** avec le motif ; sur A1 concrétisé, déclaration **201**. Réserves : `PATCH`/`DELETE` → 405, levée réservée au contrôleur (T05). Aucun `serializer` modifié n'expose de `status` ou de montant en écriture libre ; la seule mise à jour de masse de statut ajoutée concerne la clôture de tâches (`tasks`). L'aide de test `sales/testing.py::commit_lot` n'est importée par **aucun** code applicatif. |
| **Écritures sur une archive** | NOT_TESTED | Garde lue (middleware 409 et signal sur les modèles, limite déclarée pour `update()` de masse) mais non rejouée dans cette revue. |
| **Visibilité des archives (A6)** | **ÉCART** | Le constructeur liste par `GET /api/documents/`, `/api/evidences/`, `/api/work-declarations/` les objets des **instances archivées** (9 documents, 5 déclarations antérieures à `9E04`) et **télécharge** un document d'archive par lien signé (**200**). Ce sont les pièces de sa propre organisation (pas de fuite entre organisations), mais le lot 5 et `PROCEDURE_REINITIALISATION_DEMO.md` §5 énoncent que « clients, constructeur, contrôleur et Finance ne voient que l'instance active » (A6). |
| **Montants** | CONFIRMÉ | Parcours réel : frais **100 000** appelés à l'examen du dossier, complément **2 900 000** (jamais 3 000 000), total premier versement **3 000 000** sans double imputation ; décaissement jamais au-delà du disponible (T09). Montants en `Decimal` dans les services ; seul `float()` ajouté : mise en forme d'affichage de la chronologie (`pilotage/chronology.py:99`), sans calcul. Dossier concrétisé à la réunion des conditions (frais + premier versement rapprochés + contrat signé). |
| **Marquage démo** | CONFIRMÉ | En-têtes `X-Environment: DEMO` et `X-Demo-Instance: DEMO-CI-20260929-9E04` sur les réponses anonymes, authentifiées **et en erreur** (200, 400, 409) ; `simulation: true` sur le solde du programme ; encaissements « Exécuté par la banque (simulé) », « Rapproché (simulé) » ; contrat « Signé (simulé) ». |
| **Secrets** | CONFIRMÉ | Aucune ligne ajoutée (hors tests) ne contient de mot de passe, jeton ou clé en clair ; aucun `.env`, `.pem` ou clé suivi par git ; les scripts n'affichent jamais `DEMO_PASSWORD` (seulement « fourni » / « manque ») ; `render.yaml` : `SECRET_KEY` généré, `DEMO_PASSWORD` saisi hors dépôt, `DEBUG` `False`. Observation préexistante : valeur par défaut `django-insecure-dev-only-change-me` pour `SECRET_KEY` hors environnement configuré. |
| **Bascules de contexte RLS** | CONFIRMÉ, avec observation | Les bascules ajoutées (`lot_chantier_is_open`, `list_disbursements_as_beneficiary`) sont bornées et restaurées dans un `finally` ; observation : si aucun contexte n'était posé avant l'appel, le contexte du lot reste posé jusqu'à la fin de la transaction (cas non atteint par les routes, qui ont toujours une organisation active). |

## 4. Préalable joué pour T05 et T09 (parcours réel, par l'API)

Blocage de Yao sur A1 (T01) → examen du dossier par le gestionnaire (appel des frais émis) → encaissement de
100 000 rapproché par Finance → contrat créé, soumis, approuvé, signé (simulé) par Yao → complément de
2 900 000 appelé, encaissé et rapproché → **dossier concrétisé** (`committed`). Aucune écriture directe en base.

## 5. Synthèse

| Statut | Points |
|---|---|
| **CONFIRMÉ** | T01, T08, T09 ; droits serveur des routes ajoutées ; routes anonymes ; transitions d'état ; montants ; marquage démo ; secrets ; bascules RLS ; instance neuve et mot de passe |
| **ÉCART** | **T16 (critique)** : le compte applicatif, propriétaire des tables du journal, peut les vider (`TRUNCATE`) et lever leurs protections ; **T05** : tentative refusée mais non tracée au journal ; **T15** : aucune analyse des dépôts (CDC §10) ; **A6** : le constructeur voit et télécharge les objets des archives |
| **NOT_TESTED** | Rejeu par l'écran (fronts non démarrés) ; écritures sur une archive ; partie « export » de T08 (fonction reportée au Projet 1) ; tests T02–T04, T06, T07, T10–T14, T17–T20 (hors périmètre de cette revue) ; code des fronts ; suites automatisées (non relancées) |

Écarts à arbitrer par le PO (aucune correction faite) : T16 relève de la réception (§12.1, anomalie critique
sur le journal) ; T05, T15 et A6 sont à classer (majeure ou dérogation écrite). Pour mémoire, la fiche de
l'auteur (`FICHE_T01_T20.md`) marque T05, T15 et T16 CONFORME : ce rapport ne la modifie pas.

## 6. État laissé

- Instance active `DEMO-CI-20260929-9E04` avec le parcours joué : dossier de Yao sur A1 concrétisé, Fondations A1 accepté après réserve levée, deux demandes de décaissement (une annulée, une en brouillon non éligible), un document PNG de contrôle. A2 disponible.
- `DEMO-CI-20260929-2655` archivée (vide) ; `DEMO-CI-20260929-6BB7` inchangée.
- Aucune modification de fichier applicatif ; seul ce rapport est ajouté au dépôt. Les essais T16 en base ont tous été annulés.
- Pile locale laissée démarrée (Postgres, Redis, serveur) ; Render non touché.
