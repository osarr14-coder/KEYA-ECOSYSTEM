# KEYIMMO AFRIC — Cahier des charges du MVP investisseurs

## 0. Contrôle documentaire et instructions de lecture

| Champ | Valeur |
|---|---|
| Révision | V3 — proposition corrigée R1 |
| Date | 19 septembre 2026 |
| Statut | EN REVUE — non figé, non approuvé pour construction autonome |
| Document source | CAHIER_DES_CHARGES_V3_MVP(2).md |
| Objet | MVP fonctionnel de démonstration aux investisseurs, Côte d’Ivoire |
| Destinataires | Product Owner, Claude Code, Codex et responsables de revue |
| Portée | Démonstration sur données fictives ; aucune opération immobilière ou financière réelle |

Cette révision propose des corrections ; sa remise ne vaut ni validation de ses propositions ni autorisation de publier, développer ou déployer. Le document source est conservé. La configuration du Projet 1 réel n’est pas un prérequis du MVP.

Les décisions expressément validées par le Product Owner sont recensées en section 2. Les détails nouveaux des sections 3 à 12 sont des spécifications proposées pour approbation, même lorsqu’ils sont formulés comme exigences. Ils ne doivent pas être présentés comme des arbitrages déjà acquis.

Une fois approuvées, les exigences de cette révision constituent le périmètre du MVP uniquement. Les éléments de vision de la V2.2 qui ne sont pas repris restent des perspectives ; ils ne sont pas implicitement commandés. Toute contradiction avec une décision validée doit être signalée avant implémentation concernée. Un ADR technique ne peut pas remplacer une décision du Product Owner.

## 1. Finalité et invariants

Le MVP doit rendre visible et démontrer le fonctionnement de KEYIMMO AFRIC pour rechercher l’accompagnement d’investisseurs. Le Projet 1 testera ensuite le modèle sur le terrain. Une réception technique réussie ne prouve ni la viabilité économique, ni l’existence de partenaires, ni la conformité d’un dispositif réel.

- Triangle de Confiance : Production, Contrôle indépendant, Finance-Confiance. La plateforme orchestre et trace ; elle ne se substitue à aucun professionnel.
- Un jalon déclaré n’est pas un jalon techniquement accepté. Une acceptation technique n’est ni une validation juridique ni une décision bancaire.
- Un document déposé ne devient une preuve contrôlée qu’après examen tracé.
- Les indicateurs restent décomposables jusqu’à leurs sources. Aucun score global de confiance.
- Les événements critiques sont ajoutés, jamais réécrits. Une correction conserve les versions antérieures.
- Les paramètres pays sont isolés du noyau commun et leur version est rattachée aux opérations concernées.
- Le MVP ne reçoit aucun fonds, n’envoie aucune instruction bancaire réelle et n’utilise aucune identité ou pièce KYC réelle.

## 2. Registre canonique des arbitrages

Les identifiants A01–A17 sont stables et ne sont jamais réattribués. Une décision remplacée conserve son historique, sa date, son auteur et le lien vers la décision qui la remplace.

| ID | Sujet | Statut et contenu |
|---|---|---|
| A01 | Nom | VALIDÉ : KEYIMMO AFRIC ; KEYA reste un nom historique. Aucun renommage du dépôt n’est engagé par ce document. |
| A02 | Pays de démarrage | VALIDÉ : Côte d’Ivoire ; les autres pays restent dans la vision cible. |
| A03 | Projet réel | VALIDÉ : configuration différée, non bloquante pour le MVP investisseurs. |
| A04 | MVP | VALIDÉ : découverte programme/bien, dossier et réservation simulée, jalons et preuves, contrôle/réserves/corrections, paiements simulés, espace client, pilotage et historique. |
| A05 | Montage bancaire réel | OUVERT, non exercé en démonstration ; requis avant usage réel concerné. |
| A06 | Règles ADV sensibles | OUVERT ; pénalités, restitutions, copropriété, transferts et résiliations hors démonstration. |
| A07 | Architecture | PROPOSITION : monolithe modulaire, à confronter au dépôt existant avant choix de stack ou réécriture. |
| A08 | Moteur de règles | PROPOSITION : transitions explicites et paramètres versionnés ; aucun moteur générique. |
| A09 | Country Pack | PROPOSITION : mécanisme fonctionnel minimal dès le socle ; configuration CI de démonstration non validée juridiquement. |
| A10 | Monnaie | PROPOSITION, non décision héritée : XOF seul actif ; code devise conservé sur chaque montant. |
| A11 | Source de vérité | OUVERT : Git canonique proposé, exports lisibles datés. Le format Markdown ne vaut pas validation d’A11. |
| A12 | Langue | PROPOSITION : français pour interfaces et métier, anglais pour identifiants techniques, avec glossaire de correspondance. |
| A13 | Organisation des agents | VALIDÉ : Cadrage / Construction / Contrôle / Arbitrage, rôles indépendants de l’outil, contrôle indépendant et décisions tracées. |
| A14 | Sécurité | PROPOSITION : protections de démonstration décrites en section 10 ; exigences du Projet 1 à définir selon ses risques, sans présumer PAM/SOC/WORM approuvés. |
| A15 | IA produit | PROPOSITION : aucune IA dans le MVP ; aucune capacité IA ajoutée sans décision explicite. Cela n’interdit pas les agents de développement. |
| A16 | Comité | OUVERT ; module non exercé dans le MVP. |
| A17 | Réception | PROPOSITION : réception technique section 12, puis retours investisseurs distincts ; critères terrain du Projet 1 différés. |

Correspondance historique avec la synthèse Claude : ancien A11 → A08 ; A12 → A10 ; A13 → A11 ; A14 → A12 ; A15 → A16 ; A16 → A09. Les archives restent inchangées.

## 3. Périmètre proposé

| Nature | Contenu |
|---|---|
| Mécanismes réels sur données fictives | Comptes et permissions, programme/biens, dossier client, réservation, contrats versionnés, appels de fonds, jalons, fichiers, inspections, réserves, suivi des deux flux financiers, indicateurs, historique, archivage des sessions de démonstration. |
| Services externes simulés | Contrôle d’identité, signature, réception bancaire, exécution de décaissement et confirmation bénéficiaire. Chaque opération est explicitement simulée. |
| Country Pack | Mécanisme réel de sélection/versionnement ; valeurs fictives de démonstration, sans couverture juridique revendiquée. |
| Différé | Mise en demeure, résiliation, pénalités, remboursements, transferts, copropriété avancée, marketplace avancée, assurance, livraison/SAV, Comité complet, BI avancée, intégrations bancaires, IA produit et moteurs génériques. |

La liste des prestataires affectés au programme reste nécessaire ; elle n’exige pas une marketplace. Aucun logo de banque ou partenaire réel ne doit suggérer un accord inexistant.

### 3.1 Marquage et isolation

Chaque objet du scénario porte `demoInstanceId` et `environment: DEMO`. Les représentations d’actes externes portent en plus `simulation: true`, l’auteur, la date et la source simulée. Les fichiers et exports affichent « DÉMONSTRATION — DONNÉES FICTIVES » ; actes et paiements affichent aussi « SIMULÉ — SANS VALEUR OPÉRATIONNELLE ».

Le marquage s’applique aux écrans, API, téléchargements et rapports. Un attribut en base seul ne protège pas une capture d’écran. Aucun connecteur réel de paiement, signature ou notification contractuelle n’est activé. Le passage au Projet 1 exige un environnement et une validation dédiés, pas un simple retrait du badge.

## 4. Rôles et autorisations proposées

Les contrôles portent sur l’action, l’organisation, le programme, le bien et l’instance de démonstration. Ils sont appliqués côté serveur, y compris pour l’accès direct aux fichiers et exports. Les comptes démontrant des fonctions incompatibles sont distincts.

| Rôle | Droits | Interdictions |
|---|---|---|
| Client | Découvrir, créer son dossier, demander une réservation, consulter et signer fictivement son contrat, consulter son espace. | Accéder à un autre dossier, contrôler des travaux, enregistrer un mouvement bancaire. |
| Gestionnaire programme/ADV | Préparer le scénario métier, les contrats, calendriers et appels clients ; approuver le contenu du contrat fictif avant signature. | Donner un avis technique à la place du contrôleur ou déclarer un paiement exécuté. |
| Constructeur | Déclarer ses jalons, soumettre des pièces, consulter les réserves transmises, proposer des corrections ; confirmer fictivement un versement reçu. | Accepter ses travaux, lever lui-même une réserve, modifier un avis ou créer une exécution bancaire. |
| Bureau de contrôle | Consulter les pièces autorisées, examiner, émettre un avis, ouvrir/lever ses réserves, accepter techniquement après recontrôle. | Enregistrer les paiements, modifier les preuves du producteur, contrôler un jalon dont il est déclarant. |
| Finance démo | Enregistrer justificatifs bancaires fictifs, affecter les encaissements, préparer et simuler les décaissements éligibles, rapprocher et motiver les exceptions. | Modifier les avis techniques ou traiter un décaissement dont les conditions ne sont pas réunies. |
| Administrateur démo | Provisionner les comptes/scénarios, archiver et créer une nouvelle instance. | S’attribuer implicitement des pouvoirs métier, modifier ou supprimer le journal via l’application. |

Le rôle Finance représente un opérateur de simulation, pas une banque partenaire. Son fonctionnement ne préjuge pas des pouvoirs dans le Projet 1. Le journal d’administration et les actes métier restent séparément identifiables.

## 5. Modèle de domaine proposé

Les noms suivants sont indicatifs tant qu’A12 n’est pas validé. Les cardinalités et responsabilités fonctionnelles doivent être préservées.

| Objet | Données et relations minimales |
|---|---|
| DemoInstance | Identifiant, version du jeu initial, état ACTIVE/ARCHIVED, dates, origine de duplication. |
| User / Assignment | Identité fictive, rôle, organisation, périmètre autorisé ; pas de privilège déduit du seul écran. |
| CountryPackVersion | Code pays, version, paramètres typés, source fictive, date d’effet, statut DEMO_NOT_LEGALLY_VALIDATED. |
| Program / Property | Programme lié au Country Pack ; plusieurs biens, prix et devise, surfaces, disponibilité. |
| CustomerFile | Un dossier par client dans l’instance ; plusieurs réservations possibles ; contrôle d’identité simulé. |
| Reservation | Dossier, bien, état, échéance de blocage, contrat et calendrier liés. Une seule réservation active bloquante par bien. |
| ContractVersion | Réservation, numéro/version, contenu figé, auteur, approbation de contenu, signature simulée. |
| PaymentSchedule / PaymentCall | Contrat, échéances, nature frais/premier versement/versement suivant, montant et devise, date, version. |
| Milestone | Bien, prestataire affecté, état de travail, preuves versionnées, inspections et réserves ; aucune assimilation automatique au niveau de confiance. |
| EvidenceVersion / Inspection / Finding | Fichier contrôlé, déposant, horodatage ; avis lié aux versions examinées ; réserve avec proposition de correction et décision du contrôleur. |
| TrustAssessment | Objet/version, niveau, auteur, compétence/périmètre, date, justification et preuve ; chaque nouvel examen conserve l’ancien. |
| CustomerReceipt / Allocation | Encaissement fictif client vers compte programme, référence bancaire simulée, montant/devise ; affectations aux appels sans double imputation. |
| Disbursement | Mouvement fictif compte programme vers prestataire ; jalon, montant, bénéficiaire, preuve bancaire, état et rapprochement. |
| AuditEvent | Instance, objet/version, action, acteur, date serveur, changement, justification, corrélation ; pas de secrets ni mot de passe dans les événements. |

Tous les montants sont stockés en représentation exacte, sans flottants binaires pour les calculs monétaires. Le jeu proposé utilise des montants entiers XOF. Les dates sont stockées avec référence temporelle explicite ; l’interface indique son fuseau. Les liaisons entre instances sont rejetées.

## 6. Réservation et contrats

### 6.1 Disponibilité et états

Proposition de parcours : `REQUESTED → HELD → RESERVED → COMMITTED`.

| Transition | Responsable et condition |
|---|---|
| Création de REQUESTED puis HELD | Client ; disponibilité vérifiée et blocage acquis atomiquement. En cas de concurrence, une seule demande obtient le blocage, l’autre reçoit un refus explicite. |
| HELD → RESERVED | Automatique après encaissement simulé rapproché et affecté aux frais ; besoin confirmé. Le paiement des seuls frais ne concrétise pas le dossier. |
| RESERVED → COMMITTED | Contrat signé fictivement et premier versement intégralement couvert par les encaissements rapprochés affectés, après imputation unique des frais conformément au scénario. |
| HELD → EXPIRED ou CANCELLED | Échéance atteinte sans encaissement, ou annulation sans encaissement par client/gestionnaire ; libération du bien et événement tracé. |

La durée de blocage est un paramètre visible du scénario, proposé à 24 heures, sans valeur juridique. Après enregistrement d’un encaissement bancaire simulé, l’expiration automatique est suspendue pour revue Finance ; aucune libération ou restitution automatique. Désistement d’une réservation payée et remboursement sont hors MVP. Une réinitialisation crée une autre instance, sans simuler une annulation juridique.

### 6.2 Contrat fictif

`DRAFT → REVIEW → APPROVED → SIGNED_SIMULATED`. Le gestionnaire prépare, soumet et approuve le contenu ; le client réalise la signature simulée. Ce circuit simplifié n’affirme aucune indépendance de validation juridique. La version approuvée ne change pas lors de la signature. Une correction après signature crée une nouvelle version à approuver et signer fictivement, sans écraser la précédente. Chaque version et signature porte son marquage de démonstration.

## 7. Construction et confiance

### 7.1 États de travail du jalon

`DRAFT → SUBMITTED → UNDER_REVIEW → TECHNICALLY_ACCEPTED`, avec branche `UNDER_REVIEW → CHANGES_REQUIRED → RESUBMITTED → UNDER_REVIEW`.

- Le constructeur soumet une déclaration et au moins une pièce ; un dépôt seul n’accepte jamais les travaux.
- Le contrôleur examine les versions soumises. Un avis défavorable ouvre au moins une réserve ; il est transmis au constructeur avec action attendue.
- Le constructeur propose une correction et de nouvelles pièces ; il ne lève pas la réserve.
- Le contrôleur recontrôle, refuse ou lève chaque réserve. L’acceptation exige un avis conforme et aucune réserve ouverte.
- Une modification des preuves après acceptation conserve l’avis antérieur mais rend nécessaire une nouvelle revue de la version courante ; toute nouvelle demande de décaissement reste bloquée jusqu’à acceptation.

### 7.2 Niveaux de confiance distincts des états

| Niveau | Signification dans le scénario |
|---|---|
| Déclaré | Affirmation du producteur, avec auteur et date. |
| Documenté | Pièce rattachée ; authenticité et conformité non présumées. |
| Contrôlé | Examen réalisé, pouvant conclure à une non-conformité. |
| Vérifié | Point contrôlé confirmé par le contrôleur dans son périmètre, avec résultat et pièces. |
| Validé | Décision explicite d’un acteur compétent pour l’objet et son périmètre ; jamais un badge général de légalité. |

Ces niveaux ne constituent pas un compteur automatique. Dans la démonstration, l’acceptation d’un jalon peut afficher « Validé techniquement — démonstration » et préciser le contrôleur. Aucune validation notariale ou officielle n’est revendiquée. La liste des points vérifiés et les réserves demeurent visibles même lorsqu’un autre point a été validé. Un avis et son niveau restent liés à la version examinée.

## 8. Deux flux financiers simulés

### 8.1 Encaissement acquéreur vers compte du programme

Le gestionnaire émet un appel selon le calendrier du contrat fictif. Finance enregistre un encaissement bancaire simulé, rattache le justificatif et affecte la somme à un ou plusieurs appels du même dossier. Le rapprochement vérifie montant, devise, client, référence et affectations. Un versement partiel ne solde pas l’appel. Une somme non affectée reste explicitement non affectée.

Les appels clients suivent le calendrier contractuel du scénario ; ils ne sont pas tous conditionnés à l’acceptation d’un jalon de travaux. Une demande de décaissement au prestataire est un autre objet.

### 8.2 Décaissement compte du programme vers prestataire

Finance prépare une demande liée au jalon et au prestataire affecté. L’enregistrement d’une exécution bancaire fictive exige : jalon techniquement accepté dans sa version courante, aucune réserve ouverte, justificatifs présents et solde simulé disponible suffisant. Cette éligibilité applicative ne constitue pas une autorisation bancaire réelle.

La demande suit `DRAFT → ELIGIBLE → EXECUTED_SIM`. Finance déclenche le contrôle d’éligibilité ; le système réserve alors le montant. Une annulation avant exécution passe la demande à CANCELLED et libère cette réservation de fonds. Si l’acceptation technique devient caduque, la demande revient à DRAFT, sa réservation de fonds est libérée et une nouvelle éligibilité est exigée. Les conditions sont revérifiées à l’exécution ; aucune annulation silencieuse n’est possible après exécution.

Le solde est calculé à partir des encaissements rapprochés, moins les sorties exécutées ; les demandes ELIGIBLE non exécutées réservent leur montant. Une transaction empêche que deux demandes consomment simultanément le même disponible. Une sortie exécutée reste déduite même si son rapprochement est encore en attente. Le statut de demande et le statut de preuve du mouvement sont distincts et mis à jour de manière cohérente.

### 8.3 États et absence de confirmation

Les deux flux utilisent `PLANNED → BANK_EXECUTED_SIM → RECONCILED_SIM`. Pour un décaissement, `BENEFICIARY_CONFIRMED_SIM` est une étape complémentaire possible après exécution. La confirmation du prestataire n’est pas une preuve bancaire.

En l’absence de confirmation, Finance peut rapprocher manuellement sur justificatif bancaire fictif cohérent, avec motif obligatoire « Confirmation bénéficiaire non reçue ». L’absence reste visible ; elle n’est pas transformée en confirmation. Aucune temporisation ne déclenche automatiquement le rapprochement.

Chaque requête d’enregistrement est idempotente. Une référence bancaire simulée est unique par instance, compte et sens du flux ; une répétition ne crée pas un second mouvement. Après exécution, montant, devise et bénéficiaire sont immuables. Une anomalie bloque le rapprochement ; elle ne permet pas de modifier silencieusement le mouvement. Les contrepassations et remboursements métier sont différés.

## 9. Scénario démontrable et interfaces

### 9.1 Jeu de données proposé, intégralement fictif

Un programme « Résidence Démonstration Abidjan », deux biens, deux clients, un constructeur, un bureau de contrôle et les comptes gestionnaire, Finance et administrateur. Aucun acteur ne correspond à un partenaire contractuellement acquis.

Pour un bien : prix fictif 30 000 000 XOF ; frais 100 000 XOF inclus dans un premier versement de 3 000 000 XOF. Après les frais, le solde nécessaire à la concrétisation est donc 2 900 000 XOF. Ne pas déduire une deuxième fois les frais. Ces chiffres sont des données de présentation, sans portée commerciale ni réglementaire.

Deux jalons : « Fondations » et « Élévation ». Le parcours principal traite les fondations avec une réserve ; un scénario alternatif permet un avis conforme immédiat. Décaissement illustratif : 1 000 000 XOF au constructeur après acceptation, pris sur le solde fictif disponible.

Le scénario est rejouable depuis l’interface. Le gestionnaire peut déclencher un cas avec réserve ; les décisions et contrôles résultent des actions réelles des comptes et ne sont pas préremplis comme réussis.

### 9.2 Écrans et déroulement

| Étape | Écran / acteur | Résultat visible |
|---|---|---|
| 1 | Catalogue puis fiche bien / visiteur | Programme fictif, caractéristiques, prix et disponibilité. |
| 2 | Dossier et réservation / client | Blocage du bien, frais attendus et prochaine action. |
| 3 | Contrat et calendrier / gestionnaire puis client | Version approuvée, signature simulée, appels distincts. |
| 4 | Encaissements / Finance | Frais puis complément rapprochés ; réservation puis concrétisation ; HOME actualisé. |
| 5 | Chantier / constructeur | Déclaration, pièces et soumission des fondations. |
| 6 | Inspection / contrôleur | Réserve datée et motivée ; action requise pour le constructeur. |
| 7 | Correction puis recontrôle / comptes distincts | Nouvelle pièce, ancienne version conservée, levée de réserve, acceptation technique. |
| 8 | Décaissement / Finance puis constructeur | Exécution simulée ; confirmation facultative ; rapprochement et solde actualisés. |
| 9 | HOME / client | Avancement, réserve et résolution, versements du client ; sortie programme présentée comme telle, jamais comme sa dette personnelle. |
| 10 | Pilotage / gestionnaire | Indicateurs, accès aux sources autorisées, reconstruction chronologique. |
| 11 | Administration | Archivage de l’instance puis création d’une nouvelle ; archives consultables en lecture seule selon droits. |

Chaque écran gère chargement, absence de données, erreur et succès. La navigation est cohérente, les actions interdites sont expliquées sans révéler d’informations confidentielles. L’usage clavier et les libellés de formulaires sont vérifiés. Les vues client et chantier doivent être utilisables sur mobile ; mode hors connexion complet différé. Aucun écran factice ne doit afficher une opération comme accomplie alors qu’elle n’a pas eu lieu.

### 9.3 Indicateurs calculés

- Jalons examinés : nombre de jalons soumis ayant au moins un avis, divisé par les jalons soumis de l’instance ; afficher séparément les acceptations techniques courantes.
- Paiements rapprochés : nombre de mouvements rapprochés divisé par les mouvements exécutés, séparément pour entrées et sorties.
- Réserves : nombre ouvertes et levées ; ancienneté calculée à partir de la date serveur d’ouverture.
- Pièces : pièces exigées déposées / pièces exigées selon le scénario, sans assimiler présence et conformité.

Si le dénominateur est nul, afficher « Non applicable », pas 100 %. Les indicateurs respectent le périmètre autorisé ; le détail et les exports n’élargissent pas les droits. Les archives sont exclues des indicateurs actifs par défaut.

## 10. Sécurité et conservation proposées

Le caractère fictif des données ne protège pas les comptes, le service ou les secrets techniques. Pour une démonstration hébergée : accès sur invitation, HTTPS, mots de passe stockés sous forme de hachage adapté, sessions expirables/révocables, limitation des tentatives de connexion et permissions serveur sur toutes les routes.

Les fichiers restent privés. Autoriser seulement PDF, JPEG et PNG, taille maximale proposée 10 Mo ; contrôler extension, type et contenu, neutraliser les noms fournis, refuser les formats actifs, analyser les dépôts et ne pas rendre disponible un fichier en attente ou rejeté. Aucun lien public permanent aux pièces.

Les secrets sont fournis par l’environnement sécurisé et absents du dépôt, des exports et des journaux. Les endpoints de simulation et de réinitialisation sont authentifiés ; leur accès n’est jamais public. Aucun formulaire ne doit inviter à fournir une identité ou un RIB réel.

Les événements critiques et leur effet métier sont enregistrés atomiquement ou par mécanisme de fiabilité équivalent documenté. L’utilisateur applicatif ne dispose pas de modification/suppression du journal ; les éventuelles opérations d’exploitation privilégiées suivent une procédure tracée. Ne pas promettre une immutabilité absolue de l’infrastructure.

Une sauvegarde inclut base, fichiers et historique ; un exercice de restauration sur environnement isolé doit réussir avant présentation. L’archive d’une instance est cohérente et interdit ses nouvelles écritures. Sa recréation utilise le jeu initial versionné, pas des objets liés à l’ancienne instance. Définir responsable, rétention et accès aux archives avant hébergement. Les contrôles supplémentaires du Projet 1 seront déterminés séparément, sans promesse implicite de certification ou de conformité.

## 11. Organisation de la réalisation

Avant tout choix de stack : inspecter le dépôt réellement accessible, ses instructions, le code, les tests et les conventions ; identifier ce qui est réutilisable. Ne pas reconstruire automatiquement l’application ni présumer que l’ancien code est conforme.

Orientation proposée : monolithe modulaire, transactions pour les invariants, stockage privé des fichiers, machines à états testables, configuration pays versionnée. L’audit doit proposer la stack et les ADR, sans imposer de moteurs génériques, microservices ou entrepôt de données pour ce MVP.

Chaque mission possède un responsable, un périmètre et des critères de réception. Le constructeur peut challenger les exigences ; il ne peut modifier seul une décision produit. Toute modification du périmètre requiert validation explicite du Product Owner puis inscription au journal. Les arbitrages techniques ordinaires de l’architecte sont tracés ; les changements structurants nécessitent un ADR.

Revue indépendante avant intégration. Vérifier les capacités effectives de protection de branche et les identités ; ne pas prétendre qu’elles sont configurées sans preuve. Deux agents sous un même compte ne sont pas deux approbateurs indépendants. Si le contrôle technique prévu n’est pas disponible, documenter la limite et faire approuver un dispositif compensatoire avant fusion.

La préparation en branche isolée peut être organisée selon autorisation ; aucune fusion ou publication n’est induite par ce document. L’organisation détaillée des agents appartient à `docs/ai-factory/`, le présent cahier définit le produit et ses interfaces avec cette gouvernance.

## 12. Réception proposée

### 12.1 Tests traçables avant présentation

Pour chaque test : conserver identifiant, version testée, résultat, preuve et reviewer. Un critère non testé est NOT_TESTED, pas réussi. Les tests suivants devront passer sur l’environnement de démonstration ou un environnement équivalent documenté.

| ID | Situation et action | Résultat attendu |
|---|---|---|
| T01 | Deux clients demandent simultanément le même bien disponible. | Une seule réservation bloquante ; refus explicite pour l’autre. |
| T02 | Blocage impayé expiré, puis nouvelle réservation. | Bien libéré, événement conservé, nouvelle demande possible. |
| T03 | Frais 100 000 seuls, puis complément 2 900 000 rapproché et contrat signé fictivement. | RESERVED après frais ; COMMITTED seulement après toutes les conditions ; total premier versement 3 000 000, sans double imputation. |
| T04 | Tentative de modifier une version signée du contrat. | Refus ; nouvelle version requise et ancienne consultable. |
| T05 | Constructeur soumet un jalon puis tente de l’accepter ou de lever la réserve. | Refus serveur, aucune mutation métier, tentative tracée. |
| T06 | Contrôleur ouvre réserve ; constructeur corrige ; contrôleur réexamine. | CHANGES_REQUIRED puis RESUBMITTED ; acceptation seulement après avis conforme et levée de toutes les réserves. |
| T07 | Pièce remplacée après acceptation. | Version antérieure conservée ; nouvelle revue nécessaire ; nouveau décaissement bloqué. |
| T08 | Client modifie l’identifiant de dossier/fichier/export dans sa requête. | Accès à un autre client refusé sans fuite de contenu. |
| T09 | Finance demande un décaissement avec réserve ouverte ou disponible insuffisant. | Refus ; aucune exécution créée ni solde négatif. |
| T10 | Répétition d’une requête financière ; deux sorties concurrentes sur le même disponible. | Pas de doublon ; contrôle atomique du disponible. |
| T11 | Décaissement exécuté, confirmation absente, justificatif cohérent et motif Finance. | Rapprochement possible ; absence de confirmation conservée et visible. |
| T12 | Versement client partiel ou excédentaire. | Appel non soldé si partiel ; excédent non affecté, jamais consommé deux fois. |
| T13 | Lecture des écrans/API et export d’un justificatif simulé. | Identité d’instance et marquage conservés ; document clairement fictif. |
| T14 | Réinitialisation après parcours complet. | Archive consultable, nouvelle instance indépendante, statistiques actives non contaminées. |
| T15 | Dépôt interdit, trop volumineux ou non analysé ; accès direct au stockage. | Rejet ou quarantaine ; aucun accès non autorisé. |
| T16 | Modification/suppression d’événement via application ou compte applicatif. | Refus ; journal antérieur intact. |
| T17 | Sauvegarde et restauration isolée. | Dossiers, pièces, états, montants et événements cohérents avec le point sauvegardé. |
| T18 | Changement de version du Country Pack dans une nouvelle instance. | Anciennes opérations liées à leur version initiale ; modification effective du paramètre sans modification du noyau. |
| T19 | Parcours avec réserve puis parcours sans réserve, par utilisateur non technicien. | Toutes les étapes section 9 exécutables sans intervention en base ; HOME et indicateurs reflètent les événements. |
| T20 | Usage client/chantier sur mobile et navigation clavier. | Actions essentielles accessibles, erreurs compréhensibles, aucun débordement empêchant l’usage. |

La réception exige ces tests réussis, aucune anomalie critique connue sur permissions/états/finances/audit, et une revue indépendante. Une dérogation doit être explicitement approuvée avec son impact ; elle ne peut masquer une simulation comme réelle.

### 12.2 Évaluation après présentation

Recueillir séparément : compréhension du rôle de KEYIMMO AFRIC, de l’indépendance du contrôle, du rôle bancaire et des limites de simulation ; objections ; intérêt pour le Projet 1 ; conditions d’accompagnement. Ces retours ne conditionnent pas rétroactivement la réussite des tests techniques. Aucun financement ou taux de conversion n’est garanti par le MVP.

## 13. Conditions pour passer de la revue à la construction

1. Faire approuver les propositions nécessaires au MVP : A07–A12 selon leur portée, A14, A15 et A17, ainsi que les modalités métier nouvelles de cette révision. Les sujets non approuvés restent visibles ; aucune validation globale n’est déduite du seul transfert du fichier.
2. Auditer le dépôt, sélectionner la stack et vérifier les conventions, les accès et les moyens de revue.
3. Décliner les fonctionnalités en tâches reliées aux tests T01–T20 et documenter les contrats de données/API utiles avant implémentation concernée.
4. Consigner la validation du périmètre et le numéro de révision autorisé avant développement métier. Conserver les travaux indépendants non bloqués dans leur cadre autorisé.

Ni la configuration du Projet 1, ni un accord bancaire réel, ni la couverture juridique complète d’un Country Pack ne sont requis pour cette démonstration fictive. Leur absence interdit seulement les usages réels concernés.

## 14. Journal des corrections R1

| Référence de la source | Correction proposée |
|---|---|
| §2 A10 | Suppression de la validation héritée non démontrée ; propositions distinctes des décisions. |
| §3 et §6 | Mise en demeure différée ; mécanisme Country Pack fonctionnel, contenu fictif. |
| §4 | Ajout Gestionnaire et Finance démo ; matrice des droits et restrictions serveur. |
| §5 et §7 | Dossier multi-réservations, contrats/appels/affectations, réservation distincte de concrétisation, transitions et concurrence précisées. |
| §7 finances | Entrées/sorties séparées ; rapprochement sans confirmation défini ; références uniques et montants exacts. |
| §1 et §7 confiance | États de travaux distincts des niveaux de confiance, périmètre technique explicite. |
| §9–12 | Jeu fictif, écrans, indicateurs, archives, sécurité, restauration et tests détaillés. |
| §13–14 | Validation produit avant changement de périmètre ; décisions A11/A14/A17 du MVP distinctes des besoins du Projet 1. |

Cette proposition n’affirme aucune modification du dépôt, aucune mise en place de protection de branche et aucune approbation externe. Elle est destinée à la revue de Claude Code et du Product Owner avant intégration.
