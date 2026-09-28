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
| PO-2026-09-27-20 | Design system (étape 3) | `docs/design/DESIGN_SYSTEM.md` **validé**, avec ses propositions : **A-DS-1** polices Manrope et Fraunces conservées, IBM Plex Mono ajoutée pour les références ; **A-DS-2** tracés d'icônes Lucide (ISC) repris en ligne, trait 1,5, sans dépendance ; **A-DS-3** galerie interne `/design-system` dans `apps/web`, visible seulement en DÉMO ; **A-DS-4** libellés des jalons alignés sur le CDC §7.1, dérivés côté serveur ; **A-DS-5** couleur Information ajoutée (`#23577F`/`#E8F0F6`, sombre `#9CC3E4`/`#10263D`) ; **A-DS-6** réservation `held` affichée « Bien bloqué ». | Product Owner | Toutes les apps, libellés serveur. |

## 28 septembre 2026 — arbitrages du Product Owner après l'étape 3

| ID | Sujet | Décision | Auteur | Portée |
|---|---|---|---|---|
| PO-2026-09-28-01 | Menu Finance « Encaissements » | Le menu « Virements déclarés » devient **« Encaissements »**, avec deux vues : **encaissements enregistrés** et **« Signalements clients »**. Précise PO-2026-09-27-05 et PO-2026-09-27-19. | Product Owner | Back-office Finance. |
| PO-2026-09-28-02 | Traitement d'un signalement client | Action **« Rattacher à un encaissement »** (la référence de l'encaissement rattaché est affichée). Clôture **sans rattachement** seulement avec un **motif obligatoire**. Chaque traitement est tracé (journal d'audit). | Product Owner | Back-office Finance, serveur. |
| PO-2026-09-28-03 | Écart CDC §8.1 — appels de palier | Règle conservée : un appel de **palier** n'est possible qu'**après acceptation technique** du jalon ; frais de réservation et premier versement **non conditionnés**. Règle portée par un paramètre du Country Pack démo, **versionné**, marqué « non validé juridiquement ». L'acceptation **autorise** l'appel, le gestionnaire **l'émet**. Si l'acceptation devient caduque (T07) après émission, l'appel émis **reste inchangé**. | Product Owner | Appels de fonds, Country Pack démo. |
| PO-2026-09-28-04 | Niveaux de confiance | Le serveur expose, pour chaque niveau atteint, **auteur, rôle, date serveur, version examinée et périmètre**. Échelle `TrustLevels` branchée dans BUILD, l'app Contrôle et l'espace client ; `StatusBadge` retiré pour les niveaux. La garde du ticket 007 est révisée en citant cette décision. | Product Owner | BUILD, Contrôle, espace client, serveur. |
| PO-2026-09-28-05 | BUILD — navigation | Barre latérale conservée pour l'instant ; vérifier que chaque action du constructeur est faisable à 375 px. À revoir après l'audit du parcours. | Product Owner | BUILD. |
| PO-2026-09-28-06 | Libellés de signature | « Signer (simulation) » et « signée (simulation) » deviennent **« Signer (simulé) »** et **« signée (simulé) »**. Tests adaptables avec cette décision. | Product Owner | Espace client, back-office. |
| PO-2026-09-28-07 | K02 — réserve « sans description » | Vérifier que l'ouverture d'une réserve exige un motif et une action attendue ; signaler si l'affichage vient d'une donnée ancienne. | Product Owner | BUILD, serveur. |
| PO-2026-09-28-08 | BUILD — « Contrôles à planifier » | Si BUILD est utilisé par le constructeur, la section devient **« Déclarations en attente de contrôle »**, sans action de planification (J03 : le constructeur n'organise pas son contrôle). | Product Owner | BUILD. |
| PO-2026-09-28-09 | Espace client — virement signalé | Afficher **« Aucune action de votre part — Finance vérifie votre virement au relevé »** au lieu de « Votre prochaine action : Virement signalé : en attente ». | Product Owner | Espace client. |
| PO-2026-09-28-10 | Montant reçu | Dans le formulaire d'encaissement Finance, **« Montant reçu » vide par défaut** : il se lit au relevé, il ne se recopie pas du signalement. | Product Owner | Back-office Finance. |
| PO-2026-09-28-11 | Format des dates (F06) | Toutes les dates, **champs de saisie compris** (langue fr), suivent le format unique F06 (`28 sept. 2026`, `27 sept. 2026, 20:10 (GMT, Abidjan)`). | Product Owner | Toutes les apps. |

## 28 septembre 2026 — arbitrages du Product Owner après l'étape 4

| ID | Sujet | Décision | Auteur | Portée |
|---|---|---|---|---|
| PO-2026-09-28-12 | Menu Finance | Le menu « Appels et encaissements » est renommé **« Appels par dossier »** (le menu « Encaissements » de PO-2026-09-28-01 est inchangé). | Product Owner | Back-office Finance. |
| PO-2026-09-28-13 | Avis sans pièce (K01, CDC §7.2) | **Avis sans pièce interdit côté serveur** : un avis désigne au moins une version de pièce parmi celles soumises pour la déclaration. L'avis existant du lot A2 (aucune pièce désignée) n'est **pas réécrit** ; il disparaîtra à la réinitialisation. | Product Owner | API d'avis (toutes voies d'entrée). |
| PO-2026-09-28-14 | Avancement (CDC §1) | Le « % d'avancement » est remplacé par **« n / N jalons acceptés techniquement »**. Aucun pourcentage ni score dérivé des niveaux de confiance ne subsiste dans les apps. | Product Owner | HOME, BUILD, toutes apps. |
| PO-2026-09-28-15 | Capacités manquantes | L'**affectation d'une organisation constructrice** à un lot est **réservée au gestionnaire, côté serveur**. Le constructeur la voit en lecture seule. Test de refus exigé. | Product Owner | API lots, BUILD. |
| PO-2026-09-28-16 | Réserve visible (CDC §9.2 étape 9) | BUILD : sur le jalon, **motif, action attendue, date et auteur de chaque réserve ouverte**, au-dessus du formulaire de correction. Client : **résumé en langage simple** (motif, statut ouverte/levée, date), sans détail technique interne. | Product Owner | BUILD, HOME. |
| PO-2026-09-28-17 | Couleurs | La barre du jalon « Corrections demandées » prend la couleur **Attention**, cohérente avec son badge. **Le rouge est réservé aux erreurs et aux refus.** | Product Owner | Toutes apps. |
| PO-2026-09-28-18 | Personnes | Une personne s'affiche **« organisation · rôle »** (ex. « Constructeur Démonstration Abidjan · Constructeur »), **jamais d'e-mail ni de double parenthèse**, dans les niveaux de confiance, les pièces et la chronologie. | Product Owner | Toutes apps. |
| PO-2026-09-28-19 | Réinitialisation (T14) | Préparer la procédure de réinitialisation de la base à partir du jeu démo versionné, **sans l'exécuter** : l'audit du parcours est lancé ensuite dans une autre session. | Product Owner | Base locale ; Render en attente d'accord. |

## 28 septembre 2026 — arbitrages du Product Owner après l'étape 5

| ID | Sujet | Décision | Auteur | Portée |
|---|---|---|---|---|
| PO-2026-09-28-20 | Désignation explicite des pièces (complète PO-2026-09-28-13) | Un avis ne porte que sur les versions de pièces que le contrôleur **désigne explicitement**. Le serveur refuse une liste **absente** comme une liste vide : aucune règle « par défaut, toutes les pièces soumises » (CDC §7.2). | Product Owner | API d'avis, app Contrôle. |
| PO-2026-09-28-21 | Affectation | L'écran d'affectation du gestionnaire est **différé** (hors scénario). Dans BUILD, la lecture seule du constructeur affiche « Affectation réalisée par le gestionnaire ». | Product Owner | BUILD. |
| PO-2026-09-28-22 | E-mails | La règle « organisation · rôle » (PO-2026-09-28-18) s'applique à **toutes les listes du back-office**. Seule exception : *Administration › Utilisateurs* (l'e-mail y est l'identifiant de connexion). Test de garde exigé. | Product Owner | Back-office, API. |
| PO-2026-09-28-23 | Test instable de l'app Contrôle | Ni modifié ni ignoré : diagnostic de la cause, avec vérification que la synchronisation hors ligne est inactive dans le MVP (K04) ; si elle est encore active, le signaler avant toute correction. | Product Owner | App Contrôle. |
| PO-2026-09-28-24 | Variable inutilisée | Corriger la variable inutilisée de `AlertBanner.test.tsx` (aucun effet sur le comportement). | Product Owner | Design system (test). |
| PO-2026-09-28-25 | Archive consultable (CDC §9.2 étape 11, T14) | Pas d'implémentation : proposition écrite (`docs/demo/ARCHIVE_INSTANCE_PROPOSITION.md`) — consultation en lecture seule selon les droits, bandeau « ARCHIVE — LECTURE SEULE », exclusion des indicateurs actifs, effort estimé. | Product Owner | Documentation. |
| PO-2026-09-28-26 | Illustrations | Façade : ouverture de la page publique. Plan A1 : fiche du lot A1 et vignette du catalogue, ouverte en plein écran avec zoom tactile. Schéma des rôles : page publique. Mentions « programme fictif » visibles ; **aucun plan pour le lot A2** plutôt qu'un plan qui ne lui correspond pas. | Product Owner | Page publique, catalogue, fiche lot. |
| PO-2026-09-28-27 | Jauge segmentée | Composant `MilestoneGauge` : 7 états visuels issus du seul `cdc_state` serveur ; un segment par jalon, de largeur égale ; **aucun pourcentage** (compteur « n / N » en texte) ; ne représente pas les niveaux de confiance ; segments boutons accessibles ouvrant le détail du jalon ; lu comme une liste ordonnée. BUILD (carte du lot) et liste des lots gestionnaire/pilotage (version compacte, « Prochaine étape », « Qui agit »). | Product Owner | Design system, BUILD, back-office. |
| PO-2026-09-28-28 | Façade-jauge | Composant `FacadeGauge` : dessin de référence découpé par jalon, mêmes états que `MilestoneGauge` ; **une partie n'est tracée en trait plein que si son jalon est accepté techniquement**. Espace client « Suivi du chantier » (façade, « n / N », liste des jalons, phrase fixe sur la réserve, lien vers l'échelle des niveaux). Page publique : frise figée en 4 étapes, « illustration — programme fictif », aucune donnée de dossier. Couleurs par variables du thème, dessin sur surface claire en sombre, libellé SVG, la liste fait foi. | Product Owner | Design system, espace client, page publique. |
| PO-2026-09-28-29 | Galerie et gardes | Galerie : `MilestoneGauge` (7 états, carte et compacte) et `FacadeGauge` (tous états, par partie). Gardes : aucun « % » ni calcul de ratio dans ces composants ; chaque état CDC rendu ; état inconnu = erreur visible en développement, jamais « accepté » par défaut. | Product Owner | Design system. |

## 28 septembre 2026 — arbitrages du Product Owner après l'étape 6

| ID | Sujet | Décision | Auteur | Portée |
|---|---|---|---|---|
| PO-2026-09-28-30 | Synchronisation hors ligne (K04, suite de PO-2026-09-28-23) | Les routes `/api/control/sync/…` sont **coupées dans le MVP**, derrière un réglage désactivé par défaut (comme les modules masqués) : le serveur répond « introuvable ». Test exigé : un contrôleur n'agit que sur une mission qui lui est affectée, par toutes les routes restantes. Réexaminer ensuite l'utilité du test instable. | Product Owner | API Contrôle, app Contrôle. |
| PO-2026-09-28-31 | États du jalon | Le composant n'accepte que `CHANGES_REQUESTED` (nom serveur) ; correspondance avec `CHANGES_REQUIRED` (CDC §7.1) notée au glossaire. L'état d'acceptation caduque se libelle **« Nouvelle revue nécessaire »** (vocabulaire CDC §7.1) : état **calculé pour l'affichage**, sans nouvelle transition ni changement du modèle, qui bloque tout nouveau décaissement (T07). Brouillon : « Brouillon » dans les espaces de travail, **« Pas encore déclaré »** pour le client et la page publique ; correspondance au glossaire. | Product Owner | Serveur, design system, toutes apps. |
| PO-2026-09-28-32 | Page publique | La section « Chantiers » (état réel des lots) est **retirée** ; seule la frise figée reste. Repères de la frise : « 1 · Déclaration », « 2 · Réserve », « 3 · Acceptation », « 4 · Jalon suivant ». | Product Owner | Page publique. |
| PO-2026-09-28-33 | « Qui agit » | Règle confirmée : pour Resoumis et Nouvelle revue nécessaire, le **Contrôleur** si une mission est programmée, sinon **« Gestionnaire (affectation du contrôle) »**. | Product Owner | Serveur, BUILD, back-office. |
| PO-2026-09-28-34 | Client dans les listes du back-office | Affiché **« Nom fictif · Client(e) »**. | Product Owner | Back-office, API. |
| PO-2026-09-28-35 | Export CSV « Tous les lots » (BUILD) | Ajouter les colonnes « Prochaine étape » et « Qui agit ». | Product Owner | BUILD. |
| PO-2026-09-28-36 | E-mails (suite de PO-2026-09-28-22) | La règle « organisation · rôle » s'applique aussi à la **messagerie** et au **support**. Les journaux techniques non affichés gardent l'e-mail ; vérifier qu'ils ne contiennent **ni secret ni mot de passe** (CDC §10). | Product Owner | Messagerie, support, journaux. |

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
