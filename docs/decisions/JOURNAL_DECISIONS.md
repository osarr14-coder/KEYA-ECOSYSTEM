# Journal des décisions — KEYIMMO AFRIC (MVP démonstration)

Référentiel : `docs/cdc/KEYIMMO_AFRIC_CDC_V3_MVP_REVISION_R1.md` (CDC R1, §11 : toute modification
du périmètre requiert la validation explicite du Product Owner puis son inscription ici).
Audit de référence : `docs/audits/AUDIT_UI_KEYIMMO_AFRIC_R1.md`.

Chaque entrée : date, identifiant, décision, auteur, portée, éventuel remplacement. Une décision
remplacée n'est jamais effacée : elle est marquée « REMPLACÉE PAR » avec la date.

## 27 septembre 2026 — arbitrages du Product Owner sur l'audit UI R1

| ID | Sujet | Décision | Auteur | Portée |
|---|---|---|---|---|
| PO-2026-09-27-01 | J03 — désignation du contrôleur | Formulation neutre partout : « Le contrôleur est désigné indépendamment du constructeur ; les modalités de désignation et de rémunération seront définies pour le Projet 1. » Retirer « missionné par KEYIMMO ». | Product Owner | Textes de toutes les apps. |
| PO-2026-09-27-02 | C05 — étape « Validation KEYIMMO » | Supprimée du parcours client, aligné sur CDC §6.1 (`REQUESTED → HELD → RESERVED → COMMITTED`). | Product Owner | Espace client (étapes affichées). |
| PO-2026-09-27-03 | R04 — modules hors périmètre | Devis/Appels d'offres, Demandes de programme et Tarifs **masqués** dans le MVP par un flag de configuration. Le code n'est pas supprimé. | Product Owner | Back-office (navigation et accès). |
| PO-2026-09-27-04 | K04 — hors ligne de l'app Contrôle | Mode hors ligne **désactivé** pour le MVP. La date serveur fait foi. | Product Owner | Application Contrôle. |
| PO-2026-09-27-05 | F01–F02 — déclaration de virement par le client | **Ajout de périmètre** (non prévu au CDC §8.1), conservé comme **simple signalement** : ne vaut ni encaissement ni rapprochement. Source de vérité : l'encaissement simulé enregistré par Finance (justificatif, référence bancaire simulée, affectation, rapprochement), avec les libellés du CDC §8.3. | Product Owner | Espace client, Finance. |
| PO-2026-09-27-06 | Livraison des corrections de l'audit | Branche `fix/audit-ui-r1` ; aucune fusion ni déploiement sans accord ; arrêt pour relecture après chaque étape ; plus aucun push direct sur `master`. | Product Owner | Méthode de travail. |
| PO-2026-09-27-07 | Données de démonstration | Aucune suppression manuelle. Réinitialisation à partir d'un jeu initial versionné conforme au CDC §9.1 (T14), précédée d'une sauvegarde ; **exécutée en local seulement**. Render : attendre l'accord du PO. | Product Owner | Base locale ; Render en attente. |
| PO-2026-09-27-08 | R01 — inscription publique | **Retirée.** Accès uniquement par comptes de démonstration provisionnés par l'administrateur (CDC §10). « Créer mon espace » devient « Accès sur invitation », avec au plus un lien de contact, sans formulaire d'identité. Remplace la décision F-079 (inscription publique). | Product Owner | Page publique, API d'inscription. |
| PO-2026-09-27-09 | R02 — rôle administrateur | **Restreint** (CDC §4) : comptes, scénarios, archivage/création d'instance, journal en lecture seule ; aucun pouvoir métier. Un compte distinct par rôle : gestionnaire, Finance, contrôleur, constructeur, client 1, client 2, admin. Droits appliqués côté serveur. Remplace F-065 (accès de l'administrateur à tout le back-office). Option à **proposer sans l'implémenter** : sélecteur de compte visible uniquement en environnement DEMO, chaque changement étant une vraie connexion tracée. | Product Owner | Back-office, API (permissions). |
| PO-2026-09-27-10 | R03 — Finance et dossiers clients | Finance garde une vue **en lecture seule** « Appels et encaissements par dossier » (identité fictive, appels, encaissements, affectations). Aucune gestion des dossiers, réservations ou contrats. L'entrée « Dossiers clients » reste au gestionnaire. Précise F-068. | Product Owner | Back-office Finance, API. |
| PO-2026-09-27-11 | V01–V12 — direction visuelle | **Pas de nouvelle refonte.** Identité actuelle conservée (bleu nuit, doré, titres à empattements). À l'étape 3, application des règles du prompt de design (interdits, marquage démo, statuts, niveaux de confiance, montants, états), sa palette étant remplacée par les couleurs actuelles dans `docs/design/DESIGN_SYSTEM.md`. Le doré est réservé à la marque et à l'action principale. | Product Owner | Toutes les apps (étape 3). |
| PO-2026-09-27-12 | Tests en échec | Corriger le code, pas le test. Si un test est jugé faux, l'expliquer au PO **avant** de le modifier. | Product Owner | Méthode de travail. |
| PO-2026-09-27-13 | Rôle de KEYIMMO et partenaires | **KEYIMMO AFRIC lance, orchestre et gère chaque programme** ; il recrute les partenaires autour du projet. Le terme « promoteur » disparaît de la plateforme (un promoteur qui consulte KEYIMMO n'est pas un rôle) ; « constructeur » est conservé. Deux parcours partenaires distincts : candidature spontanée du partenaire (onboarding) et création de compte par KEYIMMO. Mise en œuvre à planifier (libellés, parcours sponsor, propriété des programmes par KEYIMMO — changement structurel soumis à ADR). | Product Owner | Modèle, textes, parcours partenaires. |
| PO-2026-09-27-14 | Métiers partenaires et parcours | Partenaires recrutés : **constructeurs, bureaux de contrôle, artisans**. Déroulé validé : découverte → candidature → examen par KEYIMMO → activation → annuaire → affectation à un programme lancé par KEYIMMO. Plans architecturaux produits en interne ou esquisses proposées par une IA, présentés comme **indicatifs** (les plans de permis relèvent d'un architecte habilité — règle locale à vérifier). | Product Owner | Lot « Écosystème partenaires ». |
| PO-2026-09-27-15 | Environnements | Principe accepté : trois environnements strictement séparés, **DÉMO** (données fictives), **PILOTE** (partenaires réels, aucun flux financier), **PRODUCTION** (Projet 1). Voir `docs/adr/0004-trois-environnements-demo-pilote-production.md` ; modalités et conditions d'ouverture à valider. | Product Owner | Architecture, déploiement, parcours partenaires. |
| PO-2026-09-27-16 | Comptes & décaissements | **Réservé à Finance** (CDC §4, séparation des fonctions) : le gestionnaire (ADV) ne voit plus les comptes des programmes. Appliqué côté serveur (`IsFinance` sur les routes des comptes) et dans le menu. Précise PO-2026-09-27-10. | Product Owner | Back-office, API (permissions). |
| PO-2026-09-27-17 | Modification des tests existants | Un test existant contredit par une décision inscrite à ce journal peut être adapté ; le compte rendu cite l'identifiant de cette décision pour chaque test adapté. Toute autre modification d'un test existant est soumise au PO **avant** d'être faite. Précise PO-2026-09-27-12. Les tests modifiés aux étapes 1 et 2 sont rattachés a posteriori à leur décision dans les comptes rendus ; ceux qui n'en ont pas y sont signalés. | Product Owner | Méthode de travail. |
| PO-2026-09-27-18 | C06 — échéancier du contrat | Dates **prévisionnelles fictives** affichées dans l'échéancier, libellées « prévisionnel ». Chaque appel client est émis par le gestionnaire ; aucune acceptation technique ne déclenche automatiquement un appel (CDC §8.1). | Product Owner | Espace client, calcul de l'échéancier. |
| PO-2026-09-27-19 | Encaissement sans signalement | Finance enregistre un encaissement **sans signalement préalable du client** (CDC §8.1, flux principal) : référence bancaire simulée obligatoire, justificatif fictif, affectation à un ou plusieurs appels, montant non affecté visible. Vérification T03 et T12 à l'écran. Résout la question ouverte après PO-2026-09-27-10. | Product Owner | Back-office Finance. |

## En attente d'arbitrage (mis à jour le 27 septembre 2026)

| Sujet | Question au PO |
|---|---|
| Candidature partenaire (PO-13) | Démontrée en DÉMO avec données fictives marquées ; candidatures réelles en PILOTE (ADR 0004). À confirmer. |
| Examen des candidatures | Gestionnaire (proposé), administrateur à l'activation du compte, ou rôle « Partenariats » dédié. |
| Planification | Libellés traités à l'étape 2 (« promoteur » retiré, « constructeur » conservé). Parcours sponsor « Programme sur mesure » masqué avec les modules différés (R04, réglage `KEYA_DEFERRED_MODULES_ENABLED`) en attendant le lot « Écosystème partenaires » (propriété des programmes, ADR, onboarding). |

## Faits établis à l'étape 0 de l'audit (27 septembre 2026)

- **Données parasites locales** (D01) : « Programme B-047 », le doublon « Résidence Démonstration
  Abidjan » (organisation KEYIMMO AFRIC démo, lot A12, acquereur.a/b), « Chantier Almadies »,
  « Programme Keur Massar » et les lots A3/A4 ont été créés à la main par l'agent de développement,
  sur la base **locale** uniquement, pour des vérifications (27/09, entre 00:29 et 14:08). Aucun
  n'est créé par le script de démonstration. Almadies et Keur Massar sont des noms de Dakar, hors
  périmètre A02.
- **Jeu initial non conforme** (D04) : le script de démonstration utilisait le Country Pack Sénégal
  et 8 jalons. Remplacé par le jeu versionné `DEMO-CI-v1` (Côte d'Ivoire, 2 jalons « Fondations » et
  « Élévation »). Pourcentages de paliers après le premier versement (50 %, 100 %) : **fictifs, à
  valider par le PO**.
- **Réinitialisation locale** effectuée le 27/09 à 14:49 UTC après sauvegarde (base + fichiers),
  sauvegarde vérifiée et restaurée avec succès dans une base isolée. Script :
  `backend/scripts/reset_demo_local.sh` (refuse toute base non locale).
- **Isolation par instance** (`demoInstanceId`, CDC §3.1, T14) : **non implémentée** dans le code.
  La réinitialisation locale remplace la base ; elle ne produit pas encore d'archive consultable ni
  d'instance nouvelle au sens de T14.
- **Test en échec pendant l'étape 0** (application de PO-2026-09-27-12) : une première version
  posait le Country Pack CI par une migration ; deux tests existants, qui créent eux-mêmes un pack
  « CI » sur une base vierge, échouaient sur la contrainte d'unicité. Tests jugés corrects ; **code
  corrigé** : le pack CI et ses deux jalons sont posés par le jeu de démonstration
  (`seed_demo_scenario`), jamais par une migration. Aucune base sans démonstration ne reçoit de
  donnée fictive.
